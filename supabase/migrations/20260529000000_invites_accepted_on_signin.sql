-- Mark invites as 'accepted' when the recipient actually signs in.
--
-- Until now the only writer of public.invites was the recordInvite() helper
-- (status='sent') and a single revoke path. Nothing ever transitioned
-- 'sent' → 'accepted', so the partner's invite status table was stuck on
-- "sent" forever, even after the recipient signed in and used the platform.
--
-- We watch auth.users.last_sign_in_at: every successful sign-in updates
-- that column. When it changes (any sign-in by the user), we flip any
-- pending invites for the same email to 'accepted'. The WHERE filter
-- ensures subsequent sign-ins are no-ops, so the trigger overhead per
-- sign-in for non-invited users is a single zero-row UPDATE.
--
-- We intentionally don't restrict to the FIRST sign-in: if a user is
-- invited again later (after revoke + re-invite), we want their next
-- sign-in to land that invite as accepted too.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_invites_accepted_on_signin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.invites
     SET status      = 'accepted',
         accepted_at = COALESCE(accepted_at, now())
   WHERE lower(email) = lower(NEW.email)
     AND status IN ('sent', 'opened');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_invites_accepted_on_signin ON auth.users;
CREATE TRIGGER trg_mark_invites_accepted_on_signin
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  WHEN (
    NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at
    AND NEW.last_sign_in_at IS NOT NULL
  )
  EXECUTE FUNCTION public.mark_invites_accepted_on_signin();

COMMIT;
