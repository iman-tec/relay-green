-- Widen emails_for_users → user_meta_for_admin, which also returns the
-- two auth fields the admin Users table reads: banned_until + email_
-- confirmed_at. Keeps `emails_for_users` around for callers that only
-- need the email column.

CREATE OR REPLACE FUNCTION public.user_meta_for_admin(_ids uuid[])
RETURNS TABLE (
  id                  uuid,
  email               text,
  banned_until        timestamptz,
  email_confirmed_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email, u.banned_until, u.email_confirmed_at
  FROM auth.users u
  WHERE u.id = ANY(_ids);
$$;

GRANT EXECUTE ON FUNCTION public.user_meta_for_admin(uuid[])
  TO authenticated, service_role;
