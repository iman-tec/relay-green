-- ============================================================================
-- Relay — Paid time starts at engineer claim (chat is billed too)
-- ============================================================================
-- Supersedes 20260518100000_bill_only_zoom_time.sql.
--
-- Product rule (post-clarification): the session is "live" the moment the
-- engineer claims (assigned_at). From that point on, chat IS the session
-- and counts toward both the free 10-min cap AND paid billing. Joining
-- Zoom doesn't change the billing meter — it just adds video to a session
-- that was already running.
--
-- Effect by scenario:
--   • Returning paid user, chat 5m, no Zoom, end                 → bill 5m
--   • Returning paid user, chat 5m + Zoom 10m, end at 15m        → bill 15m
--   • First-timer, chat-only 10m → upgrade → chat 2m, end at 12m → bill 2m
--     (free covered 0→10, paid_extension_at stamped at 10, bill 10→12)
--   • First-timer, free 8m and bails (no upgrade)                → bill 0,
--     free quota consumed (binary).
--   • Session that never reaches assigned (queued, cancelled)    → bill 0,
--     free quota NOT consumed (the customer never met an engineer).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.end_session(_session_id uuid, _reason text DEFAULT 'manual'::text)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s            public.guest_calls;
  _is_owner     boolean;
  _is_assigned  boolean;
  _duration_min numeric;
  _was_assigned boolean;
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
    RETURN _s;  -- idempotent
  END IF;

  -- "Session started" = engineer claimed (assigned_at). Anchors duration,
  -- free quota consumption, and paid billing. Sessions that never reached
  -- this state (queue-only) bill nothing and don't burn the free quota.
  _was_assigned := _s.assigned_at IS NOT NULL;

  IF _was_assigned THEN
    _duration_min := EXTRACT(EPOCH FROM (now() - _s.assigned_at)) / 60.0;
  ELSE
    _duration_min := 0;
  END IF;

  -- Snapshot entitlement BEFORE flipping consumed_at below so we can tell
  -- whether the free quota was burnt by a PRIOR session.
  SELECT * INTO _ent FROM customer_entitlements
    WHERE customer_user_id = _s.customer_user_id;
  _free_was_consumed_before :=
    FOUND AND _ent.free_session_consumed_at IS NOT NULL
          AND _ent.free_session_id IS DISTINCT FROM _session_id;

  -- Paid minutes for THIS session.
  --   • Never reached assigned                       → 0
  --   • Returning paid customer (free burnt before)  → bill from assigned_at
  --   • First-timer who upgraded mid-session         → bill from paid_extension_at
  --   • Still on free quota                          → 0
  IF NOT _was_assigned THEN
    _paid_min := 0;
  ELSIF _free_was_consumed_before THEN
    _paid_min := GREATEST(
      0::numeric,
      EXTRACT(EPOCH FROM (now() - _s.assigned_at)) / 60.0
    );
  ELSIF _s.paid_extension_at IS NOT NULL THEN
    _paid_min := GREATEST(
      0::numeric,
      EXTRACT(EPOCH FROM (now() - _s.paid_extension_at)) / 60.0
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
    jsonb_build_object('reason', _reason, 'duration_min', _duration_min, 'paid_min', _paid_min)
  );

  -- BINARY free consumption: any session that the engineer actually claimed
  -- burns the customer's free quota — chat-only included.
  IF _was_assigned THEN
    INSERT INTO customer_entitlements (customer_user_id)
      VALUES (_s.customer_user_id)
      ON CONFLICT DO NOTHING;
    UPDATE customer_entitlements SET
      free_session_consumed_at = COALESCE(free_session_consumed_at, now()),
      free_session_id          = COALESCE(free_session_id, _session_id),
      updated_at               = now()
    WHERE customer_user_id = _s.customer_user_id;
  END IF;

  -- Deduct paid minutes from the wallet, clamped at 0 so the balance never
  -- goes negative even if the session somehow outran funding.
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
