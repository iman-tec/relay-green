-- ============================================================================
-- pod_members.user_id must cascade when a user is deleted
-- ============================================================================
-- pod_members.user_id had NO foreign key, so hard-deleting a user (via the
-- admin "internal users" delete, which removes the auth.users row) left the
-- pod_members row behind pointing at a ghost. The pods view then resolved
-- that user's name/email to empty strings and rendered "?".
--
-- Fix: purge any already-orphaned memberships, then add the FK with
-- ON DELETE CASCADE so a deleted user is automatically removed from their
-- pod (the pod then correctly shows "no supervisor" rather than a "?" ghost).
-- ============================================================================

BEGIN;

-- 1. Remove memberships whose user no longer exists.
DELETE FROM public.pod_members pm
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pm.user_id);

-- 2. Add the missing FK. auth.users is the row the admin delete actually
--    removes, so cascading from it is the direct guarantee.
ALTER TABLE public.pod_members
  ADD CONSTRAINT pod_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;
