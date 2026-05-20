-- ============================================================================
-- Password sign-in support
-- ============================================================================
-- Supabase already stores password hashes (bcrypt) in
-- auth.users.encrypted_password and already issues JWTs on
-- signInWithPassword — no schema work needed there. The one missing piece
-- is a read-side primitive for the post-OTP redirect:
--   "does this user have a password yet?"
--
-- The cookie-bound supabase client used inside the verify-otp route can't
-- be relied on for auth.uid()-based checks immediately after verifyOtp
-- (the new JWT may not have propagated into the same request's RPC call
-- yet). Instead, the route uses the service-role admin client and calls a
-- parameterised RPC with the verified user_id explicitly — bypasses the
-- auth-context-propagation question entirely.
--
-- Both functions are SECURITY DEFINER. Public.user_has_password takes a
-- caller-supplied uuid; only the service role should invoke it (the GRANT
-- below is to authenticated for completeness, but the route uses service
-- role). public.current_user_has_password keeps the auth.uid() form for
-- any client-side use that wants it later.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.user_has_password(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _has boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT (encrypted_password IS NOT NULL AND encrypted_password <> '')
    INTO _has
    FROM auth.users
   WHERE id = _user_id;
  RETURN COALESCE(_has, false);
END $$;

GRANT EXECUTE ON FUNCTION public.user_has_password(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_has_password()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.user_has_password(auth.uid());
END $$;

GRANT EXECUTE ON FUNCTION public.current_user_has_password() TO authenticated;

COMMIT;
