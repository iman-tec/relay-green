-- ============================================================================
-- Don't reap engineers who are currently on a live call
-- ============================================================================
-- Bug: after 20260528170000 scheduled reap_idle_engineers() every 10 s,
-- engineers on a live call started getting flipped to 'offline' mid-call.
--
-- Trace:
--   1. Engineer accepts call → auto-watcher sets presence_state='busy'.
--   2. During the call, the dashboard tab becomes document.hidden=true for
--      ANY reason (alt-tab to notes, Zoom popup steals focus, picture-in-
--      picture, brief screen lock). useEngineerHeartbeat skips pings while
--      hidden — by design — so engineer_presence.last_seen_at goes stale.
--   3. 30 s later, the cron-scheduled reaper sees presence_state='busy' AND
--      last_seen_at older than 30 s → flips them to 'offline'. Their
--      engineer_sessions stint closes mid-call. Audit row gets written.
--   4. Call eventually ends. The auto-watcher in EngineerPresenceBall is
--      demote-only and has no "restore to online" branch, so they stay
--      stuck at 'offline'.
--
-- Fix: the reaper now skips engineers with an active claimed guest_calls
-- row (status in assigned/joining/live/grace). Being 'busy' DURING a call
-- is the legitimate state — we don't want to invalidate it just because
-- the tab momentarily lost visibility.
--
-- If the engineer's browser actually died mid-call (not just hidden),
-- the EXISTING reap_stale_assigned_sessions function (60 s threshold,
-- 20260528130000) abandons the guest_call. Once the call row is no
-- longer in an active status, this exclusion no longer applies, and the
-- next reap_idle_engineers tick flips the engineer offline. So the
-- safety net is still in place — it's just sequenced (60 s call-reap →
-- ~10 s presence-reap) instead of racing.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reap_idle_engineers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _reaped uuid[];
  _count  int;
BEGIN
  WITH stale AS (
    SELECT ep.user_id
      FROM public.engineer_profiles ep
      LEFT JOIN public.engineer_presence pres ON pres.engineer_id = ep.user_id
     WHERE ep.presence_state IN ('online', 'busy')
       AND (
         pres.last_seen_at IS NULL
         OR pres.last_seen_at < now() - interval '30 seconds'
       )
       -- Skip engineers currently on a live call. 'busy' is the correct
       -- state for them; flipping to 'offline' would invalidate the
       -- session stint and require them to re-toggle Online after the
       -- call. reap_stale_assigned_sessions handles the "browser actually
       -- died" case at 60 s by abandoning the call row, after which this
       -- exclusion no longer matches and the next tick flips them.
       AND NOT EXISTS (
         SELECT 1 FROM public.guest_calls gc
          WHERE gc.claimed_by = ep.user_id
            AND gc.status IN ('assigned', 'joining', 'live', 'grace')
       )
  ),
  flipped AS (
    UPDATE public.engineer_profiles ep
       SET presence_state = 'offline',
           is_available   = false,
           updated_at     = now()
      FROM stale
     WHERE ep.user_id = stale.user_id
     RETURNING ep.user_id
  )
  SELECT array_agg(user_id) INTO _reaped FROM flipped;

  _count := COALESCE(array_length(_reaped, 1), 0);
  IF _count = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.engineer_status_changes (engineer_id, is_online)
  SELECT unnest(_reaped), false;

  UPDATE public.engineer_sessions
     SET logout_time = now(), status = 'logged_out'
   WHERE engineer_id = ANY (_reaped)
     AND status = 'active';

  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.reap_idle_engineers() TO authenticated;

COMMIT;
