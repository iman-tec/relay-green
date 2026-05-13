-- Organizations for the Enterprise tab in /admin/users.
--
-- An organization is an enterprise customer account. It has one or more
-- Enterprise Admin(s) (user_roles.role = 'admin') and many customer users
-- (user_roles.role = 'builder'). Super Admin creates the Org and its first
-- Enterprise Admin; that Enterprise Admin manages the rest of the org's
-- users from their own console (built in a follow-up).

CREATE TABLE IF NOT EXISTS public.organizations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  primary_domain      text        UNIQUE,
  status              text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'suspended')),
  created_by_user_id  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Attach a user to an organization. Idempotent for existing column.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_organization_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_organization_id_fkey
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
        ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id
  ON public.profiles(organization_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Super Admins see everything. Anyone in an org sees their own org row.
DROP POLICY IF EXISTS "Super Admins read all orgs"     ON public.organizations;
DROP POLICY IF EXISTS "Members read their own org"     ON public.organizations;
DROP POLICY IF EXISTS "Super Admins write orgs"        ON public.organizations;

CREATE POLICY "Super Admins read all orgs"
  ON public.organizations FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Members read their own org"
  ON public.organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM public.profiles
      WHERE id = auth.uid() AND organization_id IS NOT NULL
    )
  );

CREATE POLICY "Super Admins write orgs"
  ON public.organizations FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
