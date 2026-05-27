-- ============================================================================
-- Session escalations — engineer raises a hand mid-call; supervisor resolves
-- ============================================================================
-- An engineer on a live session can escalate to their supervisor when they
-- need help (stuck, scope creep, angry customer, needs an estimate, etc.).
-- The supervisor sees open escalations in the /supervise act-now rail and
-- resolves them with a note. History (resolved/cancelled) powers later
-- analytics (escalation rate per engineer, recurring themes).
--
-- Scoping: pod_id is denormalized from guest_calls at escalation time so the
-- supervisor's pod-scoped query is a single indexed filter. Writes happen
-- only through the SECURITY DEFINER RPCs below — no direct client writes.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.session_escalations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  engineer_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pod_id            uuid REFERENCES public.pods(id) ON DELETE SET NULL,
  -- short category/reason, surfaced on the inbox card
  reason            text NOT NULL,
  -- optional free-text detail from the engineer
  note              text,
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolution_note   text,
  resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

-- One open escalation per session (a second escalate just refreshes it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_escalations_open_session
  ON public.session_escalations (session_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_session_escalations_pod_open
  ON public.session_escalations (pod_id, created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_session_escalations_engineer
  ON public.session_escalations (engineer_user_id, created_at DESC);

ALTER TABLE public.session_escalations ENABLE ROW LEVEL SECURITY;

-- Engineer reads their own escalations.
DROP POLICY IF EXISTS "Engineer reads own escalations" ON public.session_escalations;
CREATE POLICY "Engineer reads own escalations" ON public.session_escalations
  FOR SELECT TO authenticated
  USING (engineer_user_id = auth.uid());

-- Staff (supervisor and above) read all escalations. Pod scoping is applied
-- in the service-role supervisor API; this policy keeps direct reads safe.
DROP POLICY IF EXISTS "Staff read escalations" ON public.session_escalations;
CREATE POLICY "Staff read escalations" ON public.session_escalations
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- No INSERT/UPDATE/DELETE policies — all writes go through the RPCs below.

-- Realtime: supervisor rail + alerts subscribe to INSERT/UPDATE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'session_escalations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_escalations;
  END IF;
END $$;

-- ── RPC: engineer_escalate_session ──────────────────────────────────────────
-- Engineer-side. The caller must be the engineer who claimed the session.
-- Upserts the single open escalation for the session.
CREATE OR REPLACE FUNCTION public.engineer_escalate_session(
  _session_id uuid,
  _reason     text,
  _note       text
)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _pod    uuid;
  _owner  uuid;
  result  public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'MISSING_REASON' USING ERRCODE='P0001';
  END IF;

  SELECT claimed_by, pod_id INTO _owner, _pod FROM guest_calls WHERE id = _session_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _owner <> _me THEN
    RAISE EXCEPTION 'NOT_YOUR_SESSION' USING ERRCODE='P0001';
  END IF;

  -- Refresh an existing open escalation rather than violating the unique index.
  UPDATE session_escalations
     SET reason = btrim(_reason), note = NULLIF(btrim(_note), ''), created_at = now()
   WHERE session_id = _session_id AND status = 'open'
   RETURNING * INTO result;

  IF result.id IS NULL THEN
    INSERT INTO session_escalations (session_id, engineer_user_id, pod_id, reason, note)
    VALUES (_session_id, _me, _pod, btrim(_reason), NULLIF(btrim(_note), ''))
    RETURNING * INTO result;
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_escalate_session(uuid, text, text) TO authenticated;

-- ── RPC: resolve_escalation (supervisor) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_escalation(_id uuid, _note text)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;

  UPDATE session_escalations
     SET status = 'resolved', resolution_note = NULLIF(btrim(_note), ''),
         resolved_by = _me, resolved_at = now()
   WHERE id = _id AND status = 'open'
   RETURNING * INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'ESCALATION_NOT_OPEN' USING ERRCODE='P0001';
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_escalation(uuid, text) TO authenticated;

-- ── RPC: cancel_escalation (engineer who raised it, or a supervisor) ────────
CREATE OR REPLACE FUNCTION public.cancel_escalation(_id uuid)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  UPDATE session_escalations
     SET status = 'cancelled', resolved_by = _me, resolved_at = now()
   WHERE id = _id AND status = 'open'
     AND (
       engineer_user_id = _me
       OR has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')
     )
   RETURNING * INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'ESCALATION_NOT_OPEN_OR_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_escalation(uuid) TO authenticated;

COMMIT;
