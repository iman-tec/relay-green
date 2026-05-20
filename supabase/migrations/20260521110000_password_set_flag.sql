-- ============================================================================
-- Fix: distinguish "user set their own password" from Supabase's
-- auto-generated placeholder hash.
-- ============================================================================
-- The previous migration (20260521100000_password_signin.sql) decided
-- "user has a password" by checking auth.users.encrypted_password IS NOT
-- NULL. That doesn't work, because Supabase's admin.createUser auto-
-- generates a random password hash when called without an explicit
-- password — which is exactly what /api/auth/prepare does for every
-- first-time signup. Every pre-created user appeared to "have a
-- password" even though they couldn't actually sign in with one, so the
-- post-OTP /set-password divert never fired.
--
-- Fix: track an explicit boolean flag in auth.users.raw_app_meta_data
-- under the key 'password_set'. /api/auth/set-password flips it to true
-- after a successful updateUser({password}); the RPC reads the flag
-- instead of inspecting encrypted_password. raw_app_meta_data is
-- admin-only writable (vs raw_user_meta_data which the user can edit),
-- so the signal is trustworthy.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.user_has_password(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _flag boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT COALESCE((raw_app_meta_data->>'password_set')::boolean, false)
    INTO _flag
    FROM auth.users
   WHERE id = _user_id;
  RETURN COALESCE(_flag, false);
END $$;

-- current_user_has_password just delegates to user_has_password(auth.uid())
-- so it picks up the new logic automatically — no redefinition needed.

-- One-time cleanup: clear any stale 'password_set' flag. Before today no
-- application code ever wrote it, so the safe baseline is "nobody has
-- set a password yet." Users will get diverted to /set-password on
-- their next OTP login until they actually set one.
UPDATE auth.users
   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) - 'password_set'
 WHERE raw_app_meta_data ? 'password_set';

COMMIT;
