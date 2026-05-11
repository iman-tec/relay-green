-- ============================================================================
-- Relay — Phase 3c: free quota is BINARY (any live duration consumes it)
-- ============================================================================
-- The earlier Phase 3b migration set a 30-second grace period before
-- consuming the free quota. Per product spec we want strict binary
-- behaviour: if the customer reaches 'live' state for ANY duration
-- (even 1 second), the free quota is consumed and the next +New session
-- routes them to the paywall.
--
-- Cancellations in queue, never-went-live abandons, and engineer-side
-- ends before customer joined remain non-consuming — they're gated by
-- _went_live (joined_at IS NOT NULL).
-- ============================================================================

BEGIN;

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
    RETURN _s;
  END IF;

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

  -- BINARY consumption: any live duration burns the free quota.
  -- (Previously gated on duration_min >= 0.5 — removed per spec.)
  IF _went_live THEN
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
