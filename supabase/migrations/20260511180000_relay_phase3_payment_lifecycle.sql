-- ============================================================================
-- Relay — Phase 3: Payment lifecycle (free → expired_free → paid)
-- ============================================================================
-- Adds the buffer-and-resume behaviour around the free 10-min cap:
--   live  ─10 min, no credit──▶ expired_free  (paywall opens, buffer starts)
--   expired_free ──payment──▶ live (consuming paid_minutes)
--   expired_free ─10 min, no payment──▶ ended (reason: payment_buffer_expired)
--
-- Also tightens session creation: customers can't start a NEW session
-- without entitlement (free_session_consumed_at is null OR paid > 0).
-- ============================================================================

BEGIN;

-- Free expiration timestamp (when status flipped to expired_free)
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS free_expired_at timestamptz;

-- ── RPC: expire_to_free ────────────────────────────────────────────────────
-- Either the customer (auto from client timer) or the engineer (manual)
-- can trigger this when the 10-min free cap hits. Idempotent.

CREATE OR REPLACE FUNCTION public.expire_to_free(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s public.guest_calls;
  _is_owner    boolean;
  _is_assigned boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  _is_owner    := _s.customer_user_id = auth.uid();
  _is_assigned := _s.claimed_by       = auth.uid();
  IF NOT (_is_owner OR _is_assigned) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  -- Already expired or terminal → no-op
  IF _s.status IN ('expired_free','ended','abandoned','cancelled') THEN
    RETURN _s;
  END IF;

  IF _s.status <> 'live' THEN
    RAISE EXCEPTION 'INVALID_STATE: %', _s.status USING ERRCODE='P0001';
  END IF;

  UPDATE guest_calls SET
    status          = 'expired_free',
    free_expired_at = now(),
    updated_at      = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.expired_free', 'live', 'expired_free', NULL);

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          '⏸️ Free 10 minutes are up — waiting for payment (10 min buffer).');

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_to_free(uuid) TO authenticated;

-- ── RPC: extend_session_paid ───────────────────────────────────────────────
-- Customer resumes the call after Stripe credits their wallet.
-- Guarded by auth.uid() = customer AND paid_minutes_remaining > 0.

CREATE OR REPLACE FUNCTION public.extend_session_paid(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s   public.guest_calls;
  _ent public.customer_entitlements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  IF _s.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  IF _s.status <> 'expired_free' THEN
    RAISE EXCEPTION 'INVALID_STATE: %', _s.status USING ERRCODE='P0001';
  END IF;

  -- Entitlement check
  SELECT * INTO _ent FROM customer_entitlements WHERE customer_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR _ent.paid_minutes_remaining <= 0 THEN
    RAISE EXCEPTION 'NO_PAID_CREDIT' USING ERRCODE='P0001';
  END IF;

  -- Transition back to live; stamp paid_extension_at if not set (count-up from first pay)
  UPDATE guest_calls SET
    status              = 'live',
    paid_extension_at   = COALESCE(_s.paid_extension_at, now()),
    updated_at          = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.extended_paid', 'expired_free', 'live',
    jsonb_build_object('paid_minutes_remaining', _ent.paid_minutes_remaining));

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('💳 Payment received. Continuing on paid time (%s min available).',
                 round(_ent.paid_minutes_remaining, 0)));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.extend_session_paid(uuid) TO authenticated;

-- Also expose a service-role variant the webhook can call when crediting,
-- so resume is one round-trip (no client involvement needed).
CREATE OR REPLACE FUNCTION public.extend_session_paid_admin(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s   public.guest_calls;
  _ent public.customer_entitlements;
BEGIN
  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF _s.status <> 'expired_free' THEN RETURN _s; END IF;

  SELECT * INTO _ent FROM customer_entitlements WHERE customer_user_id = _s.customer_user_id FOR UPDATE;
  IF NOT FOUND OR _ent.paid_minutes_remaining <= 0 THEN RETURN _s; END IF;

  UPDATE guest_calls SET
    status            = 'live',
    paid_extension_at = COALESCE(_s.paid_extension_at, now()),
    updated_at        = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.extended_paid', 'expired_free', 'live',
    jsonb_build_object('via', 'webhook', 'paid_minutes_remaining', _ent.paid_minutes_remaining));

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('💳 Payment received. Continuing on paid time (%s min available).',
                 round(_ent.paid_minutes_remaining, 0)));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.extend_session_paid_admin(uuid) TO service_role;

-- ── Update get_or_create_active_customer_session — entitlement gate ────────
-- Returning an existing session is always allowed (don't lock customer out
-- of an active call). But CREATING a new one requires entitlement.

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
  _ent       public.customer_entitlements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Per-customer advisory lock (prevent dup-creation race)
  PERFORM pg_advisory_xact_lock(hashtextextended('relay-cust-session:' || auth.uid()::text, 0));

  -- Return existing active session if present
  SELECT * INTO _session
    FROM guest_calls
    WHERE customer_user_id = auth.uid()
      AND status NOT IN ('ended','abandoned','cancelled')
    ORDER BY created_at DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN _session;
  END IF;

  -- Entitlement check before creating a NEW one
  SELECT * INTO _ent FROM customer_entitlements WHERE customer_user_id = auth.uid();
  IF FOUND THEN
    IF _ent.free_session_consumed_at IS NOT NULL AND _ent.paid_minutes_remaining <= 0 THEN
      RAISE EXCEPTION 'NO_ENTITLEMENT' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO _u FROM auth.users WHERE id = auth.uid();
  _email := _u.email;
  _name  := COALESCE(NULLIF(_u.raw_user_meta_data->>'full_name',''),
                     split_part(_u.email,'@',1));

  SELECT public.find_or_create_guest_thread(_email, NULL, _name) INTO _thread;

  INSERT INTO customer_entitlements (customer_user_id) VALUES (auth.uid())
    ON CONFLICT DO NOTHING;

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

COMMIT;
