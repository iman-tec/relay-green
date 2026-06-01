-- ============================================================================
-- notifications — allow users to delete (clear) their own rows
-- ============================================================================
-- The notification bell lets a user clear notifications. The table already has
-- own-row SELECT + UPDATE policies but no DELETE policy, so a client-side
-- delete silently affects 0 rows. This adds an own-row DELETE policy.
--
-- Additive: a new policy only. Nothing dropped.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;
