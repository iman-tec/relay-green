-- ============================================================================
-- Update login_required_code to match the spec's first-login code matrix.
-- ============================================================================
-- Previous behaviour (from 20260521130000) always returned the user's own
-- department_code or enterprise_code. The spec says first-login is:
--
--   role                            code at first login
--   ───────────────────────────     ──────────────────────────
--   reseller                        none (email only)
--   organic enterprise admin        none (email only)
--   inorganic enterprise admin      reseller_code  (parent reseller's)
--   department admin                enterprise_code (parent enterprise's)
--   employee                        department_code (parent department's)
--
-- This is the only place that decides which code the /api/auth/first-login
-- send-otp endpoint requires, so updating the function in place is enough.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.login_required_code(_user_id uuid)
RETURNS TABLE (kind text, code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _is_dept_admin boolean := false;
BEGIN
  -- Resolve department-admin role once; we need it to disambiguate users
  -- who have department_id (both employees and dept admins do).
  SELECT public.has_role(_user_id, 'department_admin') INTO _is_dept_admin;

  -- Department admin → parent enterprise's enterprise_code.
  IF _is_dept_admin THEN
    RETURN QUERY
      SELECT 'enterprise'::text, o.enterprise_code
        FROM public.profiles p
        JOIN public.departments d  ON d.id = p.department_id
        JOIN public.organizations o ON o.id = d.enterprise_id
       WHERE p.id = _user_id AND p.department_id IS NOT NULL;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Employee (department_id, but NOT dept admin) → their department_code.
  RETURN QUERY
    SELECT 'department'::text, d.department_code
      FROM public.profiles p
      JOIN public.departments d ON d.id = p.department_id
     WHERE p.id = _user_id
       AND p.department_id IS NOT NULL
       AND NOT _is_dept_admin;
  IF FOUND THEN RETURN; END IF;

  -- Enterprise admin in an INORGANIC org → parent reseller's reseller_code.
  -- (Organic enterprise admins return no row — they enter only their email.)
  RETURN QUERY
    SELECT 'reseller'::text, r.reseller_code
      FROM public.profiles p
      JOIN public.organizations o ON o.id = p.organization_id
      JOIN public.resellers r     ON r.id = o.reseller_id
     WHERE p.id = _user_id
       AND p.organization_id IS NOT NULL
       AND o.enterprise_type = 'inorganic'
       AND o.reseller_id IS NOT NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.login_required_code(uuid) TO authenticated, service_role;

COMMIT;
