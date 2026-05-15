-- Performance pass for paginated list endpoints.
--
-- 1. emails_for_users(uuid[]) — SECURITY DEFINER RPC that joins auth.users
--    by id. Replaces the legacy listUsers({ perPage: 1000 }) pattern used
--    by /api/admin/users, /api/admin/assignments, /api/enterprise/users,
--    /api/internal/compensation, /api/supervisor/team. Old pattern pulled
--    all 1000 users every request; new pattern fetches emails only for
--    the ~25 rows the current page is showing.
--
-- 2. Indexes that cover the new server-side search + sort paths.

-- ── 1. emails_for_users ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emails_for_users(_ids uuid[])
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email
  FROM auth.users u
  WHERE u.id = ANY(_ids);
$$;

-- Only callable from the service role-bypassed admin client today. We
-- still grant authenticated here so we can move some lookups to direct
-- client calls later without another migration — caller is responsible
-- for not exposing the result outside the admin surfaces.
GRANT EXECUTE ON FUNCTION public.emails_for_users(uuid[]) TO authenticated, service_role;

-- ── 2. Indexes ────────────────────────────────────────────────────────────
-- profiles(organization_id, full_name) — paginated org-scoped staff list
CREATE INDEX IF NOT EXISTS idx_profiles_org_name
  ON public.profiles (organization_id, full_name);

-- profiles(primary_role) — the role filter on /admin/users
CREATE INDEX IF NOT EXISTS idx_profiles_primary_role
  ON public.profiles (primary_role);

-- profiles full_name trigram for ilike '%q%' search. Falls back gracefully
-- when pg_trgm isn't installed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
             ON public.profiles USING gin (full_name gin_trgm_ops)';
  END IF;
END $$;

-- guest_calls(status, ended_at desc) — supervise Past tab + recent sessions
CREATE INDEX IF NOT EXISTS idx_guest_calls_status_ended
  ON public.guest_calls (status, ended_at DESC NULLS LAST);

-- guest_calls(claimed_by, ended_at desc) — operations "last call" per engineer
CREATE INDEX IF NOT EXISTS idx_guest_calls_claimed_ended
  ON public.guest_calls (claimed_by, ended_at DESC NULLS LAST);

-- user_roles(role) — filter by role on /admin/users
CREATE INDEX IF NOT EXISTS idx_user_roles_role
  ON public.user_roles (role);
