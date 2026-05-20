-- ============================================================================
-- has_role: backwards-compatible legacy-role-name shim
-- ============================================================================
-- The 2026-05-20 role taxonomy reshape (see 20260521120000_roles_lookup_fk.sql)
-- renamed every role:
--
--   OLD              NEW
--   ───────────────  ──────────────────
--   admin            enterprise_admin
--   pod_lead         supervisor
--   ops_manager      department_admin
--   builder          client
--
-- Dozens of RLS policies and SECURITY DEFINER function bodies hardcode the
-- old role names in has_role(auth.uid(), '<name>') calls. After
-- 20260521120000_roles_lookup_fk.sql lands, the roles table only contains
-- the NEW names, so every legacy-named call would silently evaluate to
-- false and lock previously-authorised users out of their own data.
--
-- Rather than rewrite ~86 call sites across 18 migrations, this migration
-- updates has_role itself to recognise the legacy names and translate
-- them to the new ones before looking up. The signature (uuid, text)
-- stays unchanged.
--
-- New code should pass new role names directly. Legacy literals continue
-- to work via the CASE inside the function.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = _user_id
       AND r.name = CASE _role
         WHEN 'admin'       THEN 'enterprise_admin'
         WHEN 'pod_lead'    THEN 'supervisor'
         WHEN 'ops_manager' THEN 'department_admin'
         WHEN 'builder'     THEN 'client'
         ELSE _role
       END
  )
$$;

COMMENT ON FUNCTION public.has_role(uuid, text) IS
  'Returns true when the user holds the named role. Accepts both the '
  'current role identifiers and the four legacy names (admin, pod_lead, '
  'ops_manager, builder) which are aliased to enterprise_admin, supervisor, '
  'department_admin, and client respectively. The legacy aliasing exists '
  'so RLS policies and SECURITY DEFINER functions authored before the '
  '2026-05-20 role reshape continue to work without bulk rewriting.';

COMMIT;
