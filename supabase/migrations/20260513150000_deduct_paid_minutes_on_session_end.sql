-- Persist paid-minutes deduction when a session ends.
--
-- The previous end_session computed duration_minutes and consumed the free
-- quota, but never decremented credit_wallets.balance. After two paid calls
-- (2 + 4 min) the wallet still showed the original balance because nothing
-- wrote back. This rewrites end_session to:
--
--   1. Capture whether the customer's free quota was consumed BEFORE this
--      session (i.e. by a prior call). If so, the entire duration is paid.
--      Otherwise, only the overage beyond free_minutes is paid.
--
--   2. Decrement credit_wallets.balance by that paid amount, and bump
--      lifetime_spent by the same. balance is clamped at 0 so a session
--      that runs longer than the wallet can fund can't push it negative.
--
-- Fractional precision is preserved end-to-end: duration_minutes is
-- numeric and credit_wallets.balance is numeric, so a 2.5-minute call
-- deducts 2.5 minutes — no flooring at the DB layer.

CREATE OR REPLACE FUNCTION public.end_session(_session_id uuid, _reason text DEFAULT 'manual'::text)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s            public.guest_calls;
  _is_owner     boolean;
  _is_assigned  boolean;
  _duration_min numeric;
  _went_live    boolean;
  _ent          public.customer_entitlements;
  _free_was_consumed_before boolean;
  _paid_min     numeric;
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

  -- Snapshot entitlement BEFORE we (possibly) flip free_session_consumed_at
  -- below, so we can tell whether THIS session is the one consuming free
  -- vs whether free was burnt by an earlier session.
  SELECT * INTO _ent FROM customer_entitlements
    WHERE customer_user_id = _s.customer_user_id;
  _free_was_consumed_before :=
    FOUND AND _ent.free_session_consumed_at IS NOT NULL
          AND _ent.free_session_id IS DISTINCT FROM _session_id;

  -- Paid minutes for THIS session.
  --   • free already burnt by a prior call          → all duration is paid
  --   • paid_extension_at was stamped this session  → only time since then
  --   • neither (still on free, or ran into buffer  → 0; buffer time is not
  --     paid time and we must not bill it).
  IF _went_live THEN
    IF _free_was_consumed_before THEN
      _paid_min := _duration_min;
    ELSIF _s.paid_extension_at IS NOT NULL THEN
      _paid_min := GREATEST(
        0::numeric,
        EXTRACT(EPOCH FROM (now() - _s.paid_extension_at)) / 60.0
      );
    ELSE
      _paid_min := 0;
    END IF;
  ELSE
    _paid_min := 0;
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
    jsonb_build_object('reason', _reason, 'duration_min', _duration_min, 'paid_min', _paid_min)
  );

  -- BINARY free consumption (unchanged): any live duration burns the free quota.
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

  -- NEW: deduct paid minutes from the wallet. Clamped at 0 — we don't let
  -- the balance go negative even if the session somehow outran funding.
  IF _paid_min > 0 THEN
    INSERT INTO credit_wallets (user_id, balance, lifetime_purchased, lifetime_spent, updated_at)
      VALUES (_s.customer_user_id, 0, 0, 0, now())
      ON CONFLICT (user_id) DO NOTHING;
    UPDATE credit_wallets SET
      balance        = GREATEST(0::numeric, balance - _paid_min),
      lifetime_spent = lifetime_spent + _paid_min,
      updated_at     = now()
    WHERE user_id = _s.customer_user_id;
  END IF;

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('📞 Call ended · %s min', round(_duration_min, 1)));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.end_session(uuid, text) TO authenticated;
