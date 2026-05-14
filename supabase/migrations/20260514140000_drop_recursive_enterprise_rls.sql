-- Hotfix: drop the two enterprise_admin RLS policies introduced in
-- 20260514130000_enterprise_code_and_role.sql.
--
-- The bug:
--   CREATE POLICY "Enterprise admin reads org profiles"
--     ON public.profiles FOR SELECT
--     USING (
--       public.has_role(auth.uid(), 'enterprise_admin')
--       AND organization_id = (
--         SELECT organization_id FROM public.profiles WHERE id = auth.uid()  ← recursive
--       )
--     );
--
--   The subquery selects from public.profiles, which triggers RLS on
--   public.profiles, which evaluates THIS policy, which has a subquery on
--   public.profiles, ad infinitum. Postgres detects the recursion and
--   silently denies all reads — even the user's own row (because policies
--   are OR'd, but if one of them errors out, the whole evaluation fails).
--
-- The "Enterprise admin reads org user_roles" policy has the same problem
-- by transitive dependency: it references profiles in its USING clause,
-- and profiles' RLS now infinitely recurses.
--
-- The right fix is also the simplest: these policies aren't needed.
-- Every /api/enterprise/* route already uses the service-role client
-- (requireEnterpriseAdmin issues an `admin` client that bypasses RLS),
-- so the enterprise_admin never reads profiles/user_roles via their
-- cookie-based session. RLS only needs to gate the cookie path, which
-- the original "Users view own profile" / "Users view own roles" policies
-- already do correctly.

DROP POLICY IF EXISTS "Enterprise admin reads org profiles"   ON public.profiles;
DROP POLICY IF EXISTS "Enterprise admin reads org user_roles" ON public.user_roles;

NOTIFY pgrst, 'reload schema';
