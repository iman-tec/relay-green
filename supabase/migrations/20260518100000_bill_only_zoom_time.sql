-- ============================================================================
-- Relay — Paid minutes are billed ONLY for Zoom time (chat is free)
-- ============================================================================
-- Per product spec: paid minutes must NOT be deducted from the customer's
-- wallet unless a Zoom meeting has been joined by AT LEAST ONE party
-- (engineer OR customer). Chat-only time before any Zoom join is unbilled.
--
-- With the chat-inclusive 10-min free cap, paid_extension_at can be stamped
-- while the session is still chat-only — the prior end_session would have
-- billed that chat-only window. This revision gates billing on a derived
-- `_first_zoom_join_at` timestamp (LEAST of engineer_joined_at and
-- customer_joined_at), and clips the paid window to start no earlier than
-- that moment.
--
-- Effect by scenario:
--   • Chat-only session, no Zoom at all                  → _paid_min = 0
--   • Returning paid user, chat 5m then Zoom 10m         → bill 10m (Zoom only)
--   • First-timer upgrades at minute 10 (chat-only),
--     Zoom joined at minute 12, ends at minute 17        → bill 5m (12→17)
--   • First-timer upgrades during Zoom at minute 15,
--     ends at minute 20                                  → bill 5m
-- ============================================================================

CREATE OR REPLACE FUNCTION public.end_session(_session_id uuid, _reason text DEFAULT 'manual'::text)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s                   public.guest_calls;
  _is_owner            boolean;
  _is_assigned         boolean;
  _duration_min        numeric;
  _went_live           boolean;
  _ent                 public.customer_entitlements;
  _free_was_consumed_before boolean;
  _paid_min            numeric;
  _first_zoom_join_at  timestamptz;
  _bill_anchor         timestamptz;
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

  -- First moment Zoom became active for this session = whichever of the two
  -- per-party join timestamps fired first. NULL when neither party joined,
  -- in which case no paid minutes are billable.
  _first_zoom_join_at := CASE
    WHEN _s.engineer_joined_at IS NOT NULL AND _s.customer_joined_at IS NOT NULL
      THEN LEAST(_s.engineer_joined_at, _s.customer_joined_at)
    WHEN _s.engineer_joined_at IS NOT NULL THEN _s.engineer_joined_at
    WHEN _s.customer_joined_at IS NOT NULL THEN _s.customer_joined_at
    ELSE NULL
  END;

  -- Paid minutes billed for THIS session.
  --   • Zoom never joined by either side          → 0 (chat-only is free)
  --   • Free already burnt by a prior call        → bill from first Zoom join
  --   • Mid-session paid extension (first-timer)  → bill from MAX(paid_ext, first_zoom_join)
  --   • Otherwise (still on free, or buffer-only) → 0
  IF _first_zoom_join_at IS NULL THEN
    _paid_min := 0;
  ELSIF _free_was_consumed_before THEN
    _paid_min := GREATEST(
      0::numeric,
      EXTRACT(EPOCH FROM (now() - _first_zoom_join_at)) / 60.0
    );
  ELSIF _s.paid_extension_at IS NOT NULL THEN
    -- GREATEST returns the later of the two timestamps — billing window
    -- starts whichever happened second, so chat-only paid time before any
    -- Zoom join is excluded.
    _bill_anchor := GREATEST(_s.paid_extension_at, _first_zoom_join_at);
    _paid_min := GREATEST(
      0::numeric,
      EXTRACT(EPOCH FROM (now() - _bill_anchor)) / 60.0
    );
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
    jsonb_build_object(
      'reason', _reason,
      'duration_min', _duration_min,
      'paid_min', _paid_min,
      'first_zoom_join_at', _first_zoom_join_at
    )
  );

  -- BINARY free consumption: any live duration burns the free quota.
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

  -- Deduct paid minutes from the wallet. Clamped at 0 — we don't let the
  -- balance go negative even if the session somehow outran funding.
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
