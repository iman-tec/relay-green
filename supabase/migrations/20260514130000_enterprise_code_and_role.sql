-- Enterprise console plumbing.
--
-- 1. organizations.enterprise_code: human-shareable join code per org.
--    Format: <SLUG up to 8>-<4 random>-<4 random>, e.g. ACMECORP-7K3F-9P2X.
--    Crockford-ish (avoids 0/O/1/I) so it reads cleanly over phone.
-- 2. enterprise_admin role: distinct from platform 'admin' (ops_manager
--    pseudonym). enterprise_admin manages their own org's users only.

-- ── 1. enterprise_code on organizations ────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_code TEXT;

-- Backfill rows that pre-date this column. Slug + 8 hex chars; uniqueness
-- is virtually guaranteed because we seed md5 with the org id.
UPDATE public.organizations
   SET enterprise_code = upper(
         substr(regexp_replace(coalesce(name, 'ORG'), '[^A-Za-z0-9]', '', 'g'), 1, 8)
       )
       || '-' || upper(substr(md5(random()::text || id::text), 1, 4))
       || '-' || upper(substr(md5(random()::text || id::text || 'salt'), 1, 4))
 WHERE enterprise_code IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'organizations'
      AND constraint_name = 'organizations_enterprise_code_unique'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_enterprise_code_unique UNIQUE (enterprise_code);
  END IF;
END
$$;

ALTER TABLE public.organizations
  ALTER COLUMN enterprise_code SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_enterprise_code
  ON public.organizations(enterprise_code);

-- ── 2. enterprise_admin role ───────────────────────────────────────────
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_check;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN (
    'super_admin',
    'enterprise_admin',
    'admin',
    'ops_manager',
    'pod_lead',
    'engineer',
    'builder'
  ));

-- ── 3. RLS notes ───────────────────────────────────────────────────────
-- Earlier drafts of this migration added two policies:
--   "Enterprise admin reads org profiles" (on public.profiles)
--   "Enterprise admin reads org user_roles" (on public.user_roles)
-- Both referenced public.profiles inside a policy ON public.profiles,
-- causing infinite RLS recursion → blanket denial of own-row reads for
-- everyone. They were dropped in 20260514140000_drop_recursive_enterprise_rls.sql.
--
-- They aren't needed: every /api/enterprise/* route uses the service-role
-- client via requireEnterpriseAdmin(), which bypasses RLS. The existing
-- "Users view own profile" and "Users view own roles" policies are
-- sufficient for the cookie path.

-- (No backfill of enterprise_admin onto existing 'admin' rows. Promote
--  existing org admins by hand with:
--    INSERT INTO public.user_roles (user_id, role) VALUES
--      ('<their uuid>', 'enterprise_admin')
--    ON CONFLICT DO NOTHING;
--  Future org creates assign the role explicitly in /api/admin/orgs.)

NOTIFY pgrst, 'reload schema';
