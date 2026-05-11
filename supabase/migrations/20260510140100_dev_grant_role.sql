-- ============================================================================
-- Dev-only: self-service role grant.
-- ============================================================================
-- ⚠️  REMOVE BEFORE PRODUCTION ⚠️
-- Lets any authenticated user grant themselves a role. Used for dev/test of
-- the engineer/supervisor UI flows until proper invitation flow is built.
--
-- To remove later:
--   DROP FUNCTION IF EXISTS public.dev_grant_my_role(text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dev_grant_my_role(_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  IF _role NOT IN ('builder','engineer','pod_lead','ops_manager','admin') THEN
    RAISE EXCEPTION 'INVALID_ROLE: %', _role USING ERRCODE='P0001';
  END IF;

  -- Ensure profile row exists
  INSERT INTO profiles (id, full_name, primary_role)
  VALUES (auth.uid(),
          COALESCE((SELECT split_part(email,'@',1) FROM auth.users WHERE id = auth.uid()), 'User'),
          _role)
  ON CONFLICT (id) DO NOTHING;

  -- Grant role (idempotent)
  INSERT INTO user_roles (user_id, role)
  VALUES (auth.uid(), _role)
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.dev_grant_my_role(text) TO authenticated;
