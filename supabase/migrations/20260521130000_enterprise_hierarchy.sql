-- ============================================================================
-- Enterprise hierarchy: resellers, departments, profile codes, account_type
-- ============================================================================
-- Creation hierarchy (from project_relay_role_taxonomy memory):
--
--   super_admin         creates resellers OR enterprises + their enterprise_admin
--   reseller            creates enterprises + their enterprise_admin
--   enterprise_admin    creates departments + department_admins
--   department_admin    creates clients (employees) within their department
--
-- Codes:
--   organizations.enterprise_code  — already exists (added 2026-05-14)
--   departments.department_code    — NEW, globally unique
--   resellers.reseller_code        — NEW, globally unique
--   organizations.reseller_id      — NEW; non-null when the enterprise was
--                                    minted by a reseller (so we can trace
--                                    origin and bill accordingly)
--
-- Account type:
--   profiles.account_type — GENERATED column = 'enterprise' when the user
--                            sits inside an organization, 'organic' otherwise.
--                            Platform staff (super_admin, supervisor,
--                            engineer) and resellers count as 'organic'
--                            because they're not under any client org.
--
-- Login (two-step) is enforced application-side. See /api/auth/signin-password
-- (this migration leaves the door open by giving the API everything it needs
-- to look up the user's required code on demand).
-- ============================================================================

BEGIN;

-- ── 1. Code generator ─────────────────────────────────────────────────────
-- Mirrors the existing enterprise_code backfill format: 8-char slug from
-- the name + two 4-char random groups. Crockford-ish via uppercase hex
-- (good enough for our purposes; not strictly Crockford).
CREATE OR REPLACE FUNCTION public.gen_org_code(_name text)
RETURNS text
LANGUAGE sql VOLATILE
AS $$
  SELECT upper(substr(regexp_replace(coalesce(_name, 'ORG'), '[^A-Za-z0-9]', '', 'g'), 1, 8))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || 'salt'), 1, 4));
$$;

-- ── 2. resellers table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resellers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  reseller_code      text        NOT NULL UNIQUE,
  owner_user_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'suspended')),
  created_by_user_id uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resellers_code      ON public.resellers(reseller_code);
CREATE INDEX IF NOT EXISTS idx_resellers_owner     ON public.resellers(owner_user_id)
  WHERE owner_user_id IS NOT NULL;
ALTER TABLE public.resellers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.resellers_set_code()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE _try int := 0;
BEGIN
  IF NEW.reseller_code IS NULL OR NEW.reseller_code = '' THEN
    LOOP
      NEW.reseller_code := public.gen_org_code(NEW.name);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.resellers
         WHERE reseller_code = NEW.reseller_code AND id <> NEW.id
      );
      _try := _try + 1;
      IF _try > 10 THEN
        RAISE EXCEPTION 'reseller_code generation exhausted retries';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resellers_set_code ON public.resellers;
CREATE TRIGGER trg_resellers_set_code
  BEFORE INSERT ON public.resellers
  FOR EACH ROW EXECUTE FUNCTION public.resellers_set_code();

-- Add profiles.reseller_id now (rather than in section 5) so the policy
-- below can reference it. The FK requires the resellers table to exist,
-- which it now does.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reseller_id uuid REFERENCES public.resellers(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS resellers_super_admin_all  ON public.resellers;
DROP POLICY IF EXISTS resellers_self_read        ON public.resellers;

CREATE POLICY resellers_super_admin_all
  ON public.resellers FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Reseller users see their own reseller row (via profiles.reseller_id).
CREATE POLICY resellers_self_read
  ON public.resellers FOR SELECT
  USING (
    id IN (
      SELECT reseller_id FROM public.profiles
       WHERE id = auth.uid() AND reseller_id IS NOT NULL
    )
  );

-- ── 3. organizations: link to resellers ────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS reseller_id uuid REFERENCES public.resellers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_reseller
  ON public.organizations(reseller_id) WHERE reseller_id IS NOT NULL;

-- Auto-generate enterprise_code on insert when blank (the previous migration
-- only backfilled; now anything created via an INSERT without an explicit
-- code gets one automatically).
CREATE OR REPLACE FUNCTION public.organizations_set_code()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE _try int := 0;
BEGIN
  IF NEW.enterprise_code IS NULL OR NEW.enterprise_code = '' THEN
    LOOP
      NEW.enterprise_code := public.gen_org_code(NEW.name);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.organizations
         WHERE enterprise_code = NEW.enterprise_code AND id <> NEW.id
      );
      _try := _try + 1;
      IF _try > 10 THEN
        RAISE EXCEPTION 'enterprise_code generation exhausted retries';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_organizations_set_code ON public.organizations;
CREATE TRIGGER trg_organizations_set_code
  BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_set_code();

-- ── 4. departments table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name               text        NOT NULL,
  department_code    text        NOT NULL UNIQUE,
  admin_user_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'suspended')),
  created_by_user_id uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise_id, name)
);

CREATE INDEX IF NOT EXISTS idx_departments_enterprise ON public.departments(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_departments_code       ON public.departments(department_code);
CREATE INDEX IF NOT EXISTS idx_departments_admin      ON public.departments(admin_user_id)
  WHERE admin_user_id IS NOT NULL;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.departments_set_code()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE _try int := 0;
BEGIN
  IF NEW.department_code IS NULL OR NEW.department_code = '' THEN
    LOOP
      NEW.department_code := public.gen_org_code(NEW.name);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.departments
         WHERE department_code = NEW.department_code AND id <> NEW.id
      );
      _try := _try + 1;
      IF _try > 10 THEN
        RAISE EXCEPTION 'department_code generation exhausted retries';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_departments_set_code ON public.departments;
CREATE TRIGGER trg_departments_set_code
  BEFORE INSERT ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.departments_set_code();

-- Add profiles.department_id now (rather than in section 5) so the
-- departments_member_read policy below can reference it. The FK requires
-- the departments table to exist, which it now does.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS departments_super_admin_all     ON public.departments;
DROP POLICY IF EXISTS departments_enterprise_admin_rw ON public.departments;
DROP POLICY IF EXISTS departments_member_read         ON public.departments;

CREATE POLICY departments_super_admin_all
  ON public.departments FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Enterprise admins manage their enterprise's departments.
CREATE POLICY departments_enterprise_admin_rw
  ON public.departments FOR ALL
  USING (
    public.has_role(auth.uid(), 'enterprise_admin')
    AND enterprise_id IN (
      SELECT organization_id FROM public.profiles
       WHERE id = auth.uid() AND organization_id IS NOT NULL
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'enterprise_admin')
    AND enterprise_id IN (
      SELECT organization_id FROM public.profiles
       WHERE id = auth.uid() AND organization_id IS NOT NULL
    )
  );

-- Department admins + clients read their own department.
CREATE POLICY departments_member_read
  ON public.departments FOR SELECT
  USING (
    id IN (
      SELECT department_id FROM public.profiles
       WHERE id = auth.uid() AND department_id IS NOT NULL
    )
  );

-- ── 5. profiles: account_type + indexes + dept-requires-org guard ────────
-- (profiles.reseller_id and profiles.department_id were added earlier in
-- sections 2 and 4 so the resellers/departments policies could reference
-- them.)

-- Generated column. Always in sync with organization_id. STORED so it can
-- be indexed cheaply; the CASE expression has no volatile inputs.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text
    GENERATED ALWAYS AS (
      CASE WHEN organization_id IS NOT NULL THEN 'enterprise' ELSE 'organic' END
    ) STORED;

-- Coherent-state guard: anyone with a department must also have its
-- enterprise. (App layer normally sets both, but enforce it at the DB.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name   = 'profiles'
       AND constraint_name = 'profiles_dept_requires_org'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_dept_requires_org
      CHECK (department_id IS NULL OR organization_id IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_reseller    ON public.profiles(reseller_id)
  WHERE reseller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_department  ON public.profiles(department_id)
  WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_account_type ON public.profiles(account_type);

-- ── 6. login_required_code RPC ────────────────────────────────────────────
-- Returns the code (and code_kind) the given user must enter at sign-in,
-- or null when no code is required. Used by /api/auth/signin-password to
-- decide whether to surface the code field after password validation.
--
-- Priority: department_code > enterprise_code. A user inside a department
-- enters their department code; a user in an enterprise but without a
-- department enters the enterprise code; organic users enter nothing.
CREATE OR REPLACE FUNCTION public.login_required_code(_user_id uuid)
RETURNS TABLE (kind text, code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Department member?
  RETURN QUERY
    SELECT 'department'::text, d.department_code
      FROM public.profiles p
      JOIN public.departments d ON d.id = p.department_id
     WHERE p.id = _user_id AND p.department_id IS NOT NULL;
  IF FOUND THEN RETURN; END IF;

  -- Enterprise member without a department?
  RETURN QUERY
    SELECT 'enterprise'::text, o.enterprise_code
      FROM public.profiles p
      JOIN public.organizations o ON o.id = p.organization_id
     WHERE p.id = _user_id AND p.organization_id IS NOT NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.login_required_code(uuid) TO authenticated, service_role;

-- ── 7. verify_login_code RPC ──────────────────────────────────────────────
-- Returns true iff the supplied code matches the user's required code.
-- The login API calls this after a successful password check; on false
-- the API refuses to finalize the session.
CREATE OR REPLACE FUNCTION public.verify_login_code(_user_id uuid, _code text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _required_kind text; _required_code text;
BEGIN
  IF _code IS NULL OR _code = '' THEN
    RETURN false;
  END IF;

  SELECT kind, code INTO _required_kind, _required_code
    FROM public.login_required_code(_user_id);

  -- Organic users (no code required) treat any non-empty submission as
  -- false — the caller should never have asked. Fail closed.
  IF _required_code IS NULL THEN
    RETURN false;
  END IF;

  RETURN upper(_required_code) = upper(_code);
END $$;

GRANT EXECUTE ON FUNCTION public.verify_login_code(uuid, text) TO authenticated, service_role;

COMMIT;
