-- ============================================================================
-- allocated_minutes = CURRENTLY granted, not lifetime granted
-- ============================================================================
-- Until now profiles.allocated_minutes / departments.allocated_minutes only
-- ever incremented (transfer_to_employee / transfer_to_department in
-- 20260521170000), while the deactivation RPCs refunded the unused remainder
-- UP the chain without decrementing the child's allocated. Detach flows
-- (clearing profiles.department_id from the enterprise / super-admin panels)
-- didn't refund at all — the remainder stayed stranded on a profile that had
-- left the hierarchy.
--
-- Observable symptom: a department card summing employee allocated_minutes
-- ("41 distributed · 9 remaining" of 50) disagreed with the authoritative
-- pool the refill RPCs validate against (departments.remaining_minutes,
-- e.g. 33.648) after any deactivate / deactivate→reactivate cycle.
--
-- New invariant, maintained by every balance-moving function below
-- (modulo the end_session overrun clamp, which can only push the right side
-- ABOVE allocated, never below):
--
--   entity.allocated_minutes = entity.used_minutes + entity.remaining_minutes
--   dept.allocated_minutes   = dept.remaining_minutes
--                            + Σ(attached employees' remaining_minutes)
--                            + dept.used_minutes
--
-- Changes:
--   * deactivate_employee        — also decrements allocated by the refunded
--                                  remainder (allocated collapses to used).
--   * deactivate_department      — same at department level.
--   * release_employee_minutes   — NEW. Refund an employee's remainder to
--                                  their dept pool and collapse their
--                                  allocated, WITHOUT suspending them. For
--                                  detach flows (must run BEFORE department_id
--                                  is cleared, or the pool can't be resolved).
--   * release_department_minutes — NEW. Cascade-release all member minutes
--                                  into the dept pool, then refund the whole
--                                  pool to the enterprise. For the super-admin
--                                  "delete department" flow (must run BEFORE
--                                  the departments row is deleted).
--   * Backfill                   — shrink allocated to the invariant value
--                                  wherever historical drift exists. Never
--                                  inflates: overrun-clamp rows where
--                                  used+remaining > allocated are untouched.
-- ============================================================================

BEGIN;

-- ── deactivate_employee: refund remainder + collapse allocated ─────────────
CREATE OR REPLACE FUNCTION public.deactivate_employee(_profile_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _dept_id uuid;
  _remain  numeric;
BEGIN
  SELECT department_id, remaining_minutes
    INTO _dept_id, _remain
    FROM public.profiles
   WHERE id = _profile_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found: %', _profile_id;
  END IF;

  IF _dept_id IS NOT NULL AND _remain > 0 THEN
    UPDATE public.departments
       SET remaining_minutes = remaining_minutes + _remain
     WHERE id = _dept_id;
  END IF;

  UPDATE public.profiles
     SET status            = 'suspended',
         -- allocated tracks CURRENT grants: the refunded remainder leaves
         -- this profile, so allocated collapses to what was actually used.
         allocated_minutes = GREATEST(0, allocated_minutes - _remain),
         remaining_minutes = 0
   WHERE id = _profile_id;
END $$;

-- ── deactivate_department: refund remainder + collapse allocated ───────────
CREATE OR REPLACE FUNCTION public.deactivate_department(_dept_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _emp     record;
  _org_id  uuid;
  _remain  numeric;
BEGIN
  -- Cascade through active employees first so their balances flow back.
  FOR _emp IN
    SELECT id FROM public.profiles
     WHERE department_id = _dept_id AND status = 'active'
  LOOP
    PERFORM public.deactivate_employee(_emp.id);
  END LOOP;

  SELECT enterprise_id, remaining_minutes
    INTO _org_id, _remain
    FROM public.departments
   WHERE id = _dept_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'department not found: %', _dept_id;
  END IF;

  IF _org_id IS NOT NULL AND _remain > 0 THEN
    UPDATE public.organizations
       SET remaining_minutes = remaining_minutes + _remain
     WHERE id = _org_id;
  END IF;

  UPDATE public.departments
     SET status            = 'suspended',
         allocated_minutes = GREATEST(0, allocated_minutes - _remain),
         remaining_minutes = 0
   WHERE id = _dept_id;
END $$;

-- ── release_employee_minutes: refund WITHOUT suspending (detach flows) ─────
CREATE OR REPLACE FUNCTION public.release_employee_minutes(_profile_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _dept_id uuid;
  _remain  numeric;
BEGIN
  SELECT department_id, remaining_minutes
    INTO _dept_id, _remain
    FROM public.profiles
   WHERE id = _profile_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found: %', _profile_id;
  END IF;

  IF _remain IS NULL OR _remain <= 0 THEN
    RETURN;  -- nothing to release
  END IF;

  IF _dept_id IS NOT NULL THEN
    UPDATE public.departments
       SET remaining_minutes = remaining_minutes + _remain
     WHERE id = _dept_id;
  END IF;

  UPDATE public.profiles
     SET allocated_minutes = GREATEST(0, allocated_minutes - _remain),
         remaining_minutes = 0
   WHERE id = _profile_id;
END $$;

-- ── release_department_minutes: drain dept → enterprise (delete flows) ─────
CREATE OR REPLACE FUNCTION public.release_department_minutes(_dept_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _emp     record;
  _org_id  uuid;
  _remain  numeric;
BEGIN
  -- Pull every member's remainder back into the dept pool first.
  FOR _emp IN
    SELECT id FROM public.profiles WHERE department_id = _dept_id
  LOOP
    PERFORM public.release_employee_minutes(_emp.id);
  END LOOP;

  SELECT enterprise_id, remaining_minutes
    INTO _org_id, _remain
    FROM public.departments
   WHERE id = _dept_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'department not found: %', _dept_id;
  END IF;

  IF _org_id IS NOT NULL AND _remain > 0 THEN
    UPDATE public.organizations
       SET remaining_minutes = remaining_minutes + _remain
     WHERE id = _org_id;
  END IF;

  UPDATE public.departments
     SET allocated_minutes = GREATEST(0, allocated_minutes - _remain),
         remaining_minutes = 0
   WHERE id = _dept_id;
END $$;

GRANT EXECUTE ON FUNCTION public.release_employee_minutes(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.release_department_minutes(uuid) TO service_role;

-- ── Backfill: repair historical drift ───────────────────────────────────────
-- Profiles whose allocated still carries refunded (or stranded) grants.
-- Only shrinks — rows where used+remaining > allocated (end_session overrun
-- clamp) are left alone.
UPDATE public.profiles
   SET allocated_minutes = used_minutes + remaining_minutes
 WHERE allocated_minutes > used_minutes + remaining_minutes;

-- Departments: allocated should equal pool + held-by-attached-employees +
-- used. Anything above that is either a deactivation refund that was never
-- decremented or a remainder stranded on a since-detached profile (whose
-- profile row the backfill above just collapsed) — both write down here.
UPDATE public.departments d
   SET allocated_minutes = x.expected
  FROM (
    SELECT d2.id,
           d2.remaining_minutes + d2.used_minutes
             + COALESCE((
                 SELECT SUM(p.remaining_minutes)
                   FROM public.profiles p
                  WHERE p.department_id = d2.id
               ), 0) AS expected
      FROM public.departments d2
  ) x
 WHERE d.id = x.id
   AND d.allocated_minutes > x.expected;

COMMIT;
