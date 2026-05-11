-- ============================================================================
-- Relay — Phase 1: Session state machine, recall, urgency, entitlements
-- ============================================================================
-- Adds the customer-side primitives needed for the lifecycle:
--   queued → assigned → joining → live → grace → ending → ended
--   plus terminal: abandoned | cancelled | expired_free
--
-- All state transitions go through SECURITY DEFINER RPCs. Clients never
-- write directly to guest_calls.status — that surface is closed.
--
-- Backwards-compatible: legacy 'waiting' rows are normalised to 'queued'.
-- ============================================================================

BEGIN;

-- ── 1. Extend guest_calls with state-machine columns ────────────────────────

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS recall_count     int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urgency          text         NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_at      timestamptz,
  ADD COLUMN IF NOT EXISTS joined_at        timestamptz,
  ADD COLUMN IF NOT EXISTS engineer_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_user_id uuid,
  ADD COLUMN IF NOT EXISTS last_recall_at   timestamptz,
  ADD COLUMN IF NOT EXISTS abandoned_at     timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ended_reason     text,
  ADD COLUMN IF NOT EXISTS organization_id  uuid;

DO $$ BEGIN
  ALTER TABLE public.guest_calls
    ADD CONSTRAINT guest_calls_urgency_chk
      CHECK (urgency IN ('normal','urgent','critical'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.guest_calls
    ADD CONSTRAINT guest_calls_customer_user_fk
      FOREIGN KEY (customer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Normalise legacy values so the new state machine and old code agree.
UPDATE public.guest_calls SET status = 'queued' WHERE status = 'waiting';

-- Indexes the queue + claim flows depend on.
CREATE INDEX IF NOT EXISTS idx_guest_calls_state_queued
  ON public.guest_calls (urgency, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_guest_calls_engineer_active
  ON public.guest_calls (claimed_by)
  WHERE status IN ('assigned','joining','live','grace');

CREATE INDEX IF NOT EXISTS idx_guest_calls_customer_active
  ON public.guest_calls (customer_user_id, created_at DESC)
  WHERE status NOT IN ('ended','abandoned','cancelled');

-- ── 2. customer_entitlements (per-customer free + paid balance) ─────────────

CREATE TABLE IF NOT EXISTS public.customer_entitlements (
  customer_user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  free_session_consumed_at  timestamptz,
  free_session_id           uuid REFERENCES public.guest_calls(id) ON DELETE SET NULL,
  paid_minutes_remaining    numeric(8,2)  NOT NULL DEFAULT 0,
  paid_minutes_lifetime     numeric(10,2) NOT NULL DEFAULT 0,
  total_paid_cents          int           NOT NULL DEFAULT 0,
  created_at                timestamptz   NOT NULL DEFAULT now(),
  updated_at                timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_entitlements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "customer reads own entitlements"
    ON public.customer_entitlements FOR SELECT
    TO authenticated USING (customer_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Updates only via SECURITY DEFINER RPCs.

-- ── 3. session_recalls (immutable ledger of recall events) ──────────────────

CREATE TABLE IF NOT EXISTS public.session_recalls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  triggered_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_recalls_session
  ON public.session_recalls (session_id, triggered_at DESC);

ALTER TABLE public.session_recalls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "session participants read recalls"
    ON public.session_recalls FOR SELECT
    TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. session_audit_log (every state change captured) ──────────────────────

CREATE TABLE IF NOT EXISTS public.session_audit_log (
  id             bigserial PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role     text,
  action         text NOT NULL,
  from_state     text,
  to_state       text,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_audit_session
  ON public.session_audit_log (session_id, created_at DESC);

ALTER TABLE public.session_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "staff read session audit"
    ON public.session_audit_log FOR SELECT
    TO authenticated
    USING (
      public.has_role(auth.uid(),'engineer')   OR
      public.has_role(auth.uid(),'pod_lead')   OR
      public.has_role(auth.uid(),'ops_manager') OR
      public.has_role(auth.uid(),'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Helper: write to audit log ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._log_session_event(
  _session_id uuid,
  _action     text,
  _from_state text,
  _to_state   text,
  _metadata   jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO session_audit_log
    (session_id, actor_user_id, action, from_state, to_state, metadata)
  VALUES
    (_session_id, auth.uid(), _action, _from_state, _to_state, _metadata);
END $$;

-- ── 6. RPC: get_or_create_active_customer_session ───────────────────────────
-- Idempotent. Called when customer lands on /room. Returns the active
-- (non-terminal) session, creating a queued one if none exists.

CREATE OR REPLACE FUNCTION public.get_or_create_active_customer_session()
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _u         auth.users%ROWTYPE;
  _name      text;
  _email     text;
  _thread    uuid;
  _session   public.guest_calls;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _u FROM auth.users WHERE id = auth.uid();
  _email := _u.email;
  _name  := COALESCE(NULLIF(_u.raw_user_meta_data->>'full_name',''),
                     split_part(_u.email,'@',1));

  -- Find existing active session
  SELECT * INTO _session
    FROM guest_calls
    WHERE customer_user_id = auth.uid()
      AND status NOT IN ('ended','abandoned','cancelled')
    ORDER BY created_at DESC
    LIMIT 1;

  IF FOUND THEN
    RETURN _session;
  END IF;

  -- Find/create thread (uses existing find_or_create_guest_thread RPC)
  SELECT public.find_or_create_guest_thread(_email, NULL, _name) INTO _thread;

  -- Ensure entitlements row exists
  INSERT INTO customer_entitlements (customer_user_id) VALUES (auth.uid())
    ON CONFLICT DO NOTHING;

  -- Create new queued session
  INSERT INTO guest_calls (
    guest_name, guest_email, status, thread_id,
    customer_user_id, free_minutes
  ) VALUES (
    _name, _email, 'queued', _thread,
    auth.uid(), 10
  ) RETURNING * INTO _session;

  PERFORM _log_session_event(_session.id, 'session.created', NULL, 'queued', NULL);
  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.get_or_create_active_customer_session() TO authenticated;

-- ── 7. RPC: recall_engineer ─────────────────────────────────────────────────
-- Customer pings for help. Increments recall_count, escalates urgency at
-- thresholds (≥3 → urgent, ≥5 → critical). Rate-limited 1 per 30s.

CREATE OR REPLACE FUNCTION public.recall_engineer(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s            public.guest_calls;
  _new_count    int;
  _new_urgency  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  IF _s.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  IF _s.status NOT IN ('queued','assigned','joining') THEN
    RAISE EXCEPTION 'INVALID_STATE: %', _s.status USING ERRCODE='P0001';
  END IF;

  IF _s.last_recall_at IS NOT NULL
     AND (now() - _s.last_recall_at) < interval '30 seconds' THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='P0001';
  END IF;

  IF _s.recall_count >= 10 THEN
    RAISE EXCEPTION 'RECALL_CAP_REACHED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO session_recalls (session_id, triggered_by)
    VALUES (_session_id, auth.uid());

  _new_count := _s.recall_count + 1;
  _new_urgency := CASE
    WHEN _new_count >= 5 THEN 'critical'
    WHEN _new_count >= 3 THEN 'urgent'
    ELSE _s.urgency
  END;

  UPDATE guest_calls SET
    recall_count   = _new_count,
    urgency        = _new_urgency,
    last_recall_at = now(),
    updated_at     = now()
  WHERE id = _session_id
  RETURNING * INTO _s;

  PERFORM _log_session_event(
    _session_id, 'session.recall', _s.status, _s.status,
    jsonb_build_object('recall_count', _new_count, 'urgency', _new_urgency)
  );

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.recall_engineer(uuid) TO authenticated;

-- ── 8. RPC: cancel_customer_session ─────────────────────────────────────────
-- Customer chose to cancel before going LIVE. Free session NOT consumed.

CREATE OR REPLACE FUNCTION public.cancel_customer_session(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _s public.guest_calls;
BEGIN
  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF _s.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF _s.status NOT IN ('queued','assigned') THEN
    RAISE EXCEPTION 'INVALID_STATE: %', _s.status USING ERRCODE='P0001';
  END IF;

  UPDATE guest_calls SET
    status       = 'cancelled',
    cancelled_at = now(),
    ended_reason = 'customer_cancelled',
    updated_at   = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.cancelled', 'queued', 'cancelled', NULL);
  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_session(uuid) TO authenticated;

-- ── 9. Cron-callable: abandon stale queued sessions (>3 min) ────────────────

CREATE OR REPLACE FUNCTION public.abandon_stale_queued_sessions()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _count int;
BEGIN
  WITH abandoned AS (
    UPDATE guest_calls SET
      status       = 'abandoned',
      abandoned_at = now(),
      ended_reason = 'queue_timeout_3min',
      updated_at   = now()
    WHERE status = 'queued'
      AND created_at < now() - interval '3 minutes'
    RETURNING id
  )
  SELECT count(*)::int INTO _count FROM abandoned;
  RETURN COALESCE(_count, 0);
END $$;

-- pg_cron is available on Supabase Pro. Schedule if extension present.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'relay-abandon-stale-queued',
      '* * * * *',
      $cron$SELECT public.abandon_stale_queued_sessions();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Cron schedule may already exist or extension not in pg_cron schema.
  -- Safe to ignore — Next.js side has a fallback.
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

-- Allow the service role (Next.js cron route) to call this.
GRANT EXECUTE ON FUNCTION public.abandon_stale_queued_sessions() TO service_role;

COMMIT;
