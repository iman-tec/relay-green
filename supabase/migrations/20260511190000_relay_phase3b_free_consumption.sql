-- ============================================================================
-- Relay — Phase 3b: free quota is consumed on END, not on JOIN
-- ============================================================================
-- Previously mark_joined() stamped customer_entitlements.free_session_consumed_at
-- the moment both parties were marked joined → status='live'. That meant a
-- customer who clicked Accept and immediately closed the tab burned their
-- one-and-only free session for what was effectively a no-op.
--
-- Fix: move the consumption to end_session(), gated by a minimum live duration
-- (30 seconds). Sessions that ended within 30s of going live do NOT consume
-- the free quota.
-- ============================================================================

BEGIN;

-- ── mark_joined: no longer touches customer_entitlements ───────────────────

CREATE OR REPLACE FUNCTION public.mark_joined(
  _session_id uuid,
  _role       text
) RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s public.guest_calls;
  _both boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _role NOT IN ('customer','engineer') THEN
    RAISE EXCEPTION 'INVALID_ROLE: %', _role USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  IF _role = 'customer' AND _s.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF _role = 'engineer' AND _s.claimed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_YOU' USING ERRCODE='P0001';
  END IF;

  IF _role = 'customer' AND _s.customer_joined_at IS NULL THEN
    UPDATE guest_calls SET customer_joined_at = now(), updated_at = now()
      WHERE id = _session_id RETURNING * INTO _s;
  ELSIF _role = 'engineer' AND _s.engineer_joined_at IS NULL THEN
    UPDATE guest_calls SET engineer_joined_at = now(), updated_at = now()
      WHERE id = _session_id RETURNING * INTO _s;
  END IF;

  _both := (_s.customer_joined_at IS NOT NULL) AND (_s.engineer_joined_at IS NOT NULL);

  IF _both AND _s.status IN ('assigned','joining','grace') THEN
    UPDATE guest_calls SET
      status     = 'live',
      joined_at  = LEAST(COALESCE(_s.joined_at, now()), now()),
      started_at = COALESCE(_s.started_at, now()),
      updated_at = now()
    WHERE id = _session_id RETURNING * INTO _s;

    PERFORM _log_session_event(_session_id, 'session.live', 'joining', 'live', NULL);

    INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
    VALUES (_session_id, 'system', 'Relay', '📞 Call started');

  ELSIF _s.status = 'assigned' THEN
    UPDATE guest_calls SET status = 'joining', updated_at = now()
      WHERE id = _session_id RETURNING * INTO _s;
    PERFORM _log_session_event(_session_id, 'session.joining',
      'assigned', 'joining',
      jsonb_build_object('role', _role)
    );
  END IF;

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_joined(uuid, text) TO authenticated;

-- ── end_session: consume free quota here, only if duration ≥ 30s ───────────

CREATE OR REPLACE FUNCTION public.end_session(
  _session_id uuid,
  _reason     text DEFAULT 'manual'
) RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s            public.guest_calls;
  _is_owner     boolean;
  _is_assigned  boolean;
  _duration_min numeric;
  _went_live    boolean;
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

  IF _s.status IN ('ended','abandoned','cancelled') THEN
    RETURN _s;  -- idempotent
  END IF;

  -- Did this session ever reach 'live'? joined_at is stamped on that transition.
  _went_live := _s.joined_at IS NOT NULL;

  IF _went_live THEN
    _duration_min := EXTRACT(EPOCH FROM (now() - _s.joined_at)) / 60.0;
  ELSE
    _duration_min := 0;
  END IF;

  UPDATE guest_calls SET
    status            = 'ended',
    ended_at          = now(),
    duration_minutes  = _duration_min,
    free_minutes_used = LEAST(_s.free_minutes::numeric, _duration_min),
    ended_reason      = _reason,
    updated_at        = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.ended',
    NULL, 'ended',
    jsonb_build_object('reason', _reason, 'duration_min', _duration_min)
  );

  -- Consume the customer's free quota IFF they reached live AND stayed
  -- there for at least 30 seconds (0.5 min). Quitting in under 30s is
  -- treated as a no-op — they don't lose their one free session.
  IF _went_live AND _duration_min >= 0.5 THEN
    INSERT INTO customer_entitlements (customer_user_id)
      VALUES (_s.customer_user_id)
      ON CONFLICT DO NOTHING;
    UPDATE customer_entitlements SET
      free_session_consumed_at = COALESCE(free_session_consumed_at, now()),
      free_session_id          = COALESCE(free_session_id, _session_id),
      updated_at               = now()
    WHERE customer_user_id = _s.customer_user_id;
  END IF;

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('📞 Call ended · %s min', round(_duration_min, 1)));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.end_session(uuid, text) TO authenticated;

COMMIT;
