-- ============================================================================
-- Roles: text + CHECK  →  lookup table + FK
-- ============================================================================
-- Previous shape:  user_roles.role text CHECK (role IN ('builder', ...))
-- New shape:       user_roles.role_id uuid REFERENCES roles(id)
--
-- The user_roles table is empty in dev right now (tables were cleared
-- before this migration was written), so we drop+recreate the role column
-- destructively. If you ever run this against a populated database, port
-- this migration to a backfill flow before applying.
--
-- has_role(uuid, text) keeps its existing signature so the dozens of RLS
-- policies and helper functions that say has_role(auth.uid(), 'admin')
-- keep working untouched. Internally it now joins through roles by name.
-- ============================================================================

BEGIN;

-- ── 1. Lookup table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  rank        smallint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Creation hierarchy (top → bottom):
--   super_admin   creates  reseller  OR  enterprise + its enterprise_admin
--   reseller      creates  enterprise + its enterprise_admin
--   enterprise_admin  creates  departments + department_admins
--   department_admin  creates  clients (their employees) within their department
--
-- Platform-side roles (supervisor, engineer) sit OUTSIDE this customer/
-- reseller/enterprise/department hierarchy — they're employees of the
-- platform itself who take and oversee support sessions.
INSERT INTO public.roles (name, label, description, rank) VALUES
  ('super_admin',      'Super Admin',      'Platform owner. Creates resellers, and creates enterprises plus their initial enterprise admin.', 100),
  ('reseller',         'Reseller',         'Commercial broker. Creates enterprises (and their initial enterprise admin) on behalf of partner customers.', 90),
  ('enterprise_admin', 'Enterprise Admin', 'Top role inside an enterprise. Creates departments and department admins.',                                    80),
  ('department_admin', 'Department Admin', 'Manages a single department within an enterprise. Adds clients (employees) to their department.',              70),
  ('supervisor',       'Supervisor',       'Platform-side. Oversees engineers and monitors live sessions.',                                                50),
  ('engineer',         'Engineer',         'Platform-side. Takes support calls and runs sessions.',                                                        30),
  ('client',           'Client',           'End-user employee within a department. Books help sessions.',                                                  10)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_select_all ON public.roles;
CREATE POLICY roles_select_all ON public.roles FOR SELECT USING (true);
GRANT SELECT ON public.roles TO authenticated, anon;

-- ── 2. user_roles: drop text column, add role_id FK ───────────────────────
-- Legacy dashboard-managed RLS policies on a handful of (orphan) tables
-- read user_roles.role directly, which blocks DROP COLUMN. Drop them by
-- name first. Of the fifteen, only org_compensation_read_same_org is on
-- a table the current app uses; it's recreated against the new role_id
-- column in section 6. The other fourteen sit on tables (audit_logs,
-- engineer_notes, customer_follow_ups, supervisor_events, supervisor_notes,
-- projects, organizations, organization_codes, enterprise_user_policies,
-- hour_buckets, hour_ledger_entries, waitlist) that the live app no longer
-- references — they're vestiges of an earlier Lovable-managed schema.
DROP POLICY IF EXISTS "Staff view all audit rows"                            ON public.audit_logs;
DROP POLICY IF EXISTS "Staff view engineer notes"                            ON public.engineer_notes;
DROP POLICY IF EXISTS "Customer + engineer + staff view follow-ups"          ON public.customer_follow_ups;
DROP POLICY IF EXISTS "Staff view supervisor events"                         ON public.supervisor_events;
DROP POLICY IF EXISTS "Supervisor creates events"                            ON public.supervisor_events;
DROP POLICY IF EXISTS "Pod lead+ view supervisor notes"                      ON public.supervisor_notes;
DROP POLICY IF EXISTS "Supervisor creates notes"                             ON public.supervisor_notes;
DROP POLICY IF EXISTS "Staff views all projects"                             ON public.projects;
DROP POLICY IF EXISTS "Internal admin views all orgs"                        ON public.organizations;
DROP POLICY IF EXISTS "Internal admin manages org codes"                     ON public.organization_codes;
DROP POLICY IF EXISTS "Internal admin views all policies"                    ON public.enterprise_user_policies;
DROP POLICY IF EXISTS "Staff views all buckets"                              ON public.hour_buckets;
DROP POLICY IF EXISTS "Staff views all ledger"                               ON public.hour_ledger_entries;
DROP POLICY IF EXISTS "Ops and admin read waitlist"                          ON public.waitlist;
DROP POLICY IF EXISTS "org_compensation_read_same_org"                       ON public.org_compensation;

DROP INDEX IF EXISTS public.idx_user_roles_user_role;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles DROP COLUMN IF EXISTS role;

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE RESTRICT;

ALTER TABLE public.user_roles
  ALTER COLUMN role_id SET NOT NULL;

ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_id_key;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_role_id
  ON public.user_roles(user_id, role_id);

-- ── 3. has_role: same (uuid, text) signature, new internals ────────────────
-- Keeps every existing RLS policy + helper function working unchanged.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = _user_id
       AND r.name     = _role
  )
$$;

-- ── 4. profiles.primary_role: text → FK ───────────────────────────────────
-- Same refactor wave: the parallel free-text role surface on profiles
-- becomes a nullable FK into the lookup. Nullable because not every
-- profile holds a "primary" role (a brand-new customer may have none).
ALTER TABLE public.profiles DROP COLUMN IF EXISTS primary_role;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_primary_role_id
  ON public.profiles(primary_role_id) WHERE primary_role_id IS NOT NULL;

-- ── 5. Convenience views: surface role *names* to callers ─────────────────
-- Used by routes that previously read user_roles.role / profiles.primary_role
-- directly. Keeps callers from needing to join the lookup themselves.
CREATE OR REPLACE VIEW public.user_role_names AS
  SELECT ur.user_id, r.name AS role
    FROM public.user_roles ur
    JOIN public.roles      r ON r.id = ur.role_id;

GRANT SELECT ON public.user_role_names TO authenticated, anon;

CREATE OR REPLACE VIEW public.profiles_with_role AS
  SELECT p.*,
         r.name  AS primary_role,
         r.label AS primary_role_label
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.primary_role_id;

GRANT SELECT ON public.profiles_with_role TO authenticated, anon;

-- ── 6. grant_role / revoke_role RPCs (admin-gated) ────────────────────────
-- Replaces dev_grant_my_role (self-grant). These are the production-shaped
-- mutation primitives: only super_admin or admin callers may grant, and
-- only super_admin may grant or revoke super_admin itself.
CREATE OR REPLACE FUNCTION public.grant_role(_user_id uuid, _role_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _role_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  IF NOT (public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='P0001';
  END IF;

  IF _role_name = 'super_admin' AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only super_admin may grant super_admin'
      USING ERRCODE='P0001';
  END IF;

  SELECT id INTO _role_id FROM public.roles WHERE name = _role_name;
  IF _role_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE: %', _role_name USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.profiles (id, full_name, primary_role_id)
  SELECT _user_id,
         COALESCE(split_part(email, '@', 1), 'User'),
         _role_id
    FROM auth.users WHERE id = _user_id
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (_user_id, _role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.grant_role(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_role(_user_id uuid, _role_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _role_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  IF NOT (public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED' USING ERRCODE='P0001';
  END IF;

  IF _role_name = 'super_admin' AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: only super_admin may revoke super_admin'
      USING ERRCODE='P0001';
  END IF;

  SELECT id INTO _role_id FROM public.roles WHERE name = _role_name;
  IF _role_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_ROLE: %', _role_name USING ERRCODE='P0001';
  END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _user_id AND role_id = _role_id;
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_role(uuid, text) TO authenticated;

-- ── 7. Bootstrap helper: first super_admin only ───────────────────────────
-- grant_role refuses to mint super_admin unless the caller is already
-- super_admin — chicken-and-egg on a fresh database. bootstrap_super_admin
-- works exactly once, while zero super_admins exist. Call via service-role
-- from the bootstrap-super-admin.ts script.
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _role_id uuid; _count int;
BEGIN
  SELECT count(*) INTO _count
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE r.name = 'super_admin';
  IF _count > 0 THEN
    RAISE EXCEPTION 'SUPER_ADMIN_ALREADY_EXISTS' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO _role_id FROM public.roles WHERE name = 'super_admin';

  INSERT INTO public.profiles (id, full_name, primary_role_id)
  SELECT _user_id,
         COALESCE(split_part(email, '@', 1), 'User'),
         _role_id
    FROM auth.users WHERE id = _user_id
  ON CONFLICT (id) DO UPDATE SET primary_role_id = EXCLUDED.primary_role_id;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (_user_id, _role_id);
END $$;

-- Service-role only — never grant to authenticated.
REVOKE ALL ON FUNCTION public.bootstrap_super_admin(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin(uuid) TO service_role;

-- ── 8. Retire dev_grant_my_role ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.dev_grant_my_role(text);

-- ── 9. Recreate the one in-use policy we dropped in section 2 ─────────────
-- org_compensation_read_same_org gates /api/internal/compensation. We
-- recreate it here against role_id (joining through the roles table) so
-- enterprise + department admins can still read their org's payroll.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'org_compensation'
      AND schemaname = 'public' AND policyname = 'org_compensation_read_same_org'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY org_compensation_read_same_org ON public.org_compensation
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.user_roles ur ON ur.user_id = p.id
            JOIN public.roles r       ON r.id       = ur.role_id
            WHERE p.id = auth.uid()
              AND p.organization_id = org_compensation.organization_id
              AND r.name IN ('enterprise_admin', 'department_admin')
          )
        )
    $POL$;
  END IF;
END $$;

COMMIT;
