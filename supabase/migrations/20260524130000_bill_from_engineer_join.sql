-- ============================================================================
-- end_session: bill from the engineer's JOIN, not the claim
-- ============================================================================
-- Previously the billing/timer anchor was assigned_at (the moment the engineer
-- claimed the session and chat opened). Per product feedback the paid timer
-- must start only once the engineer actually JOINS the call
-- (engineer_joined_at) — pre-join chat is not billed. A session where the
-- engineer never joins bills nothing and does NOT burn the customer's free
-- session.
--
-- This redefines end_session (last set in 20260521200000) swapping the anchor
-- assigned_at → engineer_joined_at everywhere: duration, free-quota
-- consumption, and paid-minute deduction (both the legacy wallet path and the
-- employee dept-pool path). The first-timer mid-session upgrade still bills
-- from paid_extension_at. The client clock (lib/relay/sessionClock.ts) anchors
-- on the same field so every surface agrees.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.end_session(_session_id uuid, _reason text DEFAULT 'manual'::text)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s                          public.guest_calls;
  _is_owner                   boolean;
  _is_assigned                boolean;
  _duration_min               numeric;
  _was_joined                 boolean;
  _anchor                     timestamptz;
  _ent                        public.customer_entitlements;
  _free_was_consumed_before   boolean;
  _paid_min                   numeric;
  _is_employee                boolean := false;
  _emp_dept_id                uuid;
  _emp_org_id                 uuid;
  _emp_reseller_id            uuid;
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

  -- "Session billing started" = engineer JOINED the call (engineer_joined_at).
  -- Anchors duration, free quota consumption, and paid billing. A session the
  -- engineer never joined (claim + chat only) bills nothing and doesn't burn
  -- the free quota.
  _anchor     := _s.engineer_joined_at;
  _was_joined := _anchor IS NOT NULL;

  IF _was_joined THEN
    _duration_min := EXTRACT(EPOCH FROM (now() - _anchor)) / 60.0;
  ELSE
    _duration_min := 0;
  END IF;

  -- Resolve customer role + hierarchy in one read so we know which billing
  -- path to take.
  SELECT
    (p.client_type = 'employee'),
    p.department_id,
    p.organization_id
  INTO _is_employee, _emp_dept_id, _emp_org_id
  FROM public.profiles p
  WHERE p.id = _s.customer_user_id;

  -- Snapshot legacy entitlement BEFORE flipping consumed_at below so we can
  -- tell whether the free quota was burnt by a PRIOR session.
  SELECT * INTO _ent FROM customer_entitlements
    WHERE customer_user_id = _s.customer_user_id;
  _free_was_consumed_before :=
    FOUND AND _ent.free_session_consumed_at IS NOT NULL
          AND _ent.free_session_id IS DISTINCT FROM _session_id;

  -- Paid minutes for THIS session, all anchored on the join.
  --   • Never joined                                 → 0
  --   • Returning paid customer (free burnt before)  → bill from join
  --   • First-timer who upgraded mid-session         → bill from paid_extension_at
  --   • Still on free quota                          → 0
  IF NOT _was_joined THEN
    _paid_min := 0;
  ELSIF _free_was_consumed_before THEN
    _paid_min := GREATEST(0::numeric, EXTRACT(EPOCH FROM (now() - _anchor)) / 60.0);
  ELSIF _s.paid_extension_at IS NOT NULL THEN
    _paid_min := GREATEST(0::numeric, EXTRACT(EPOCH FROM (now() - _s.paid_extension_at)) / 60.0);
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
      'reason',       _reason,
      'duration_min', _duration_min,
      'paid_min',     _paid_min,
      'billing_path', CASE WHEN _is_employee THEN 'employee' ELSE 'legacy' END,
      'anchor',       'engineer_joined_at'
    )
  );

  -- ── Branch on caller type ──────────────────────────────────────────────
  IF _is_employee THEN
    IF _was_joined AND _duration_min > 0 THEN
      UPDATE public.profiles
         SET used_minutes      = used_minutes + _duration_min,
             remaining_minutes = GREATEST(0::numeric, remaining_minutes - _duration_min)
       WHERE id = _s.customer_user_id;

      IF _emp_dept_id IS NOT NULL THEN
        UPDATE public.departments
           SET used_minutes = used_minutes + _duration_min
         WHERE id = _emp_dept_id;
      END IF;
      IF _emp_org_id IS NOT NULL THEN
        UPDATE public.organizations
           SET used_minutes = used_minutes + _duration_min
         WHERE id = _emp_org_id;
        SELECT reseller_id INTO _emp_reseller_id
          FROM public.organizations
         WHERE id = _emp_org_id;
        IF _emp_reseller_id IS NOT NULL THEN
          UPDATE public.resellers
             SET used_minutes = used_minutes + _duration_min
           WHERE id = _emp_reseller_id;
        END IF;
      END IF;
    END IF;
  ELSE
    -- Legacy free/paid path.

    -- BINARY free consumption: a session the engineer actually JOINED burns
    -- the customer's free quota. Chat-only / never-joined sessions don't.
    IF _was_joined THEN
      INSERT INTO customer_entitlements (customer_user_id)
        VALUES (_s.customer_user_id)
        ON CONFLICT DO NOTHING;
      UPDATE customer_entitlements SET
        free_session_consumed_at = COALESCE(free_session_consumed_at, now()),
        free_session_id          = COALESCE(free_session_id, _session_id),
        updated_at               = now()
      WHERE customer_user_id = _s.customer_user_id;
    END IF;

    -- Deduct paid minutes from the wallet, clamped at 0.
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
  END IF;

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('📞 Call ended · %s min', round(_duration_min, 1)));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.end_session(uuid, text) TO authenticated;

COMMIT;
