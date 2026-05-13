-- super_admin is the platform-owner role and should satisfy every RLS
-- policy that gates on has_role(). Rather than rewrite every CREATE POLICY,
-- we patch has_role() so a super_admin row is treated as holding any
-- requested role.
--
-- Concretely: has_role(uid, 'engineer') returns true if the user has
-- engineer OR super_admin. Same for pod_lead / ops_manager / admin.
-- Existing per-row data is untouched; only permission checks change.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = _role OR role = 'super_admin')
  )
$$;
