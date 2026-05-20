-- ============================================================================
-- end_session: deduct minutes from the dept hierarchy for employee callers
-- ============================================================================
-- The function was last redefined in 20260518110000_bill_from_assigned.sql.
-- That version only knows two billing paths:
--   • customer_entitlements (free quota, consumed-at flag)
--   • credit_wallets         (paid balance decrement)
-- Both are for the legacy free/paid system. Employees draw from the dept
-- pool (profiles.remaining_minutes seeded via transfer_to_employee), so
-- under the old function their dept allocation was never decremented and
-- the per-tier `used_minutes` rollups never advanced.
--
-- New behaviour: when the session's customer is an employee
-- (profiles.client_type='employee') and the engineer actually claimed
-- (assigned_at IS NOT NULL):
--   • Debit profiles.used_minutes + remaining_minutes by _duration_min
--   • Roll _duration_min UP the chain into used_minutes (only) on
--     departments → organizations → resellers (if inorganic). Remaining
--     pools on parents don't change — those minutes were already
--     subtracted at transfer time. used_minutes is a reporting rollup.
--   • Skip the legacy customer_entitlements + credit_wallets writes —
--     employees don't have a free quota or a personal credit wallet.
--
-- Non-employees: behaviour is unchanged.
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
  _was_assigned               boolean;
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

  -- "Session started" = engineer claimed (assigned_at). Anchors duration,
  -- free quota consumption, and paid billing. Sessions that never reached
  -- this state (queue-only) bill nothing and don't burn the free quota.
  _was_assigned := _s.assigned_at IS NOT NULL;

  IF _was_assigned THEN
    _duration_min := EXTRACT(EPOCH FROM (now() - _s.assigned_at)) / 60.0;
  ELSE
    _duration_min := 0;
  END IF;

  -- Resolve customer role + hierarchy in one read so we know which billing
  -- path to take. The hierarchy ids are NULL for non-employees, which is
  -- fine — they don't enter the employee branch below.
  SELECT
    (p.client_type = 'employee'),
    p.department_id,
    p.organization_id
  INTO _is_employee, _emp_dept_id, _emp_org_id
  FROM public.profiles p
  WHERE p.id = _s.customer_user_id;

  -- Snapshot legacy entitlement BEFORE flipping consumed_at below so we
  -- can tell whether the free quota was burnt by a PRIOR session.
  -- (Employees skip this — see the IF below.)
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
    jsonb_build_object(
      'reason',       _reason,
      'duration_min', _duration_min,
      'paid_min',     _paid_min,
      'billing_path', CASE WHEN _is_employee THEN 'employee' ELSE 'legacy' END
    )
  );

  -- ── Branch on caller type ──────────────────────────────────────────────
  IF _is_employee THEN
    -- Employees draw from the dept-pool chain (profiles.remaining_minutes
    -- + per-tier used_minutes rollups). They never touch
    -- customer_entitlements or credit_wallets — those tables are for the
    -- legacy free/paid customers.
    IF _was_assigned AND _duration_min > 0 THEN
      -- Leaf debit: employee's own bucket.
      UPDATE public.profiles
         SET used_minutes      = used_minutes + _duration_min,
             remaining_minutes = GREATEST(0::numeric, remaining_minutes - _duration_min)
       WHERE id = _s.customer_user_id;

      -- Roll usage up the chain. We only update used_minutes on parents;
      -- their remaining_minutes was already debited at transfer time when
      -- minutes flowed downward, so we don't touch it again here.
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
    -- Legacy free/paid path — exactly as before the employee branch.

    -- BINARY free consumption: any session that the engineer actually
    -- claimed burns the customer's free quota — chat-only included.
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

    -- Deduct paid minutes from the wallet, clamped at 0 so the balance
    -- never goes negative even if the session somehow outran funding.
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
