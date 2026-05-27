-- ============================================================================
-- Reaper for orphaned 'assigned' / 'joining' sessions
-- ============================================================================
-- The matcher's eligibility filter excludes any engineer who appears in a
-- guest_calls row with status IN ('assigned','joining','live','grace',
-- 'expired_free','ending'). If an engineer accepts a match but then never
-- finishes joining (tab closed mid-flight, network drop before the heartbeat
-- stabilises, prior bug in the call lifecycle that didn't notify the server
-- on unmount), their row sits forever in 'assigned' — and they look "busy"
-- to every subsequent match attempt. Customer sees "no engineers online"
-- even though everyone really is.
--
-- This adds a no-op-safe reaper that flips such rows to 'abandoned' once the
-- engineer has clearly walked away from the assignment. Definition of "walked
-- away":
--
--   status IN ('assigned','joining')
--   AND claimed_by IS NOT NULL
--   AND assigned_at < now() - interval '60 seconds'    -- past join grace
--   AND NOT EXISTS (
--     SELECT 1 FROM engineer_presence p
--      WHERE p.engineer_id = gc.claimed_by
--        AND p.last_seen_at > now() - interval '60 seconds'
--   )
--
-- 'live' / 'grace' are out-of-scope on purpose — those need a different
-- recovery path that respects the existing payment-buffer + summary chain.
-- This is for the pre-live wedge only.
--
-- Safe to call repeatedly. SECURITY DEFINER so the matcher can invoke it
-- without RLS on guest_calls in the way.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reap_stale_assigned_sessions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _count int;
BEGIN
  UPDATE public.guest_calls AS gc
     SET status = 'abandoned',
         updated_at = now()
   WHERE gc.status IN ('assigned', 'joining')
     AND gc.claimed_by IS NOT NULL
     AND gc.assigned_at < now() - interval '60 seconds'
     AND NOT EXISTS (
       SELECT 1
         FROM public.engineer_presence p
        WHERE p.engineer_id = gc.claimed_by
          AND p.last_seen_at > now() - interval '60 seconds'
     );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.reap_stale_assigned_sessions() TO authenticated;

-- Best-effort cleanup of any rows already stuck at migration-apply time.
-- No-op when there's nothing to reap.
SELECT public.reap_stale_assigned_sessions();

COMMIT;

-- ─── How to schedule (optional) ─────────────────────────────────────────────
-- If pg_cron is enabled, run periodically (e.g. every 30 s):
--   SELECT cron.schedule(
--     'reap_stale_assigned_sessions',
--     '30 seconds',
--     $$SELECT public.reap_stale_assigned_sessions();$$
--   );
-- Otherwise the matcher can call it inline at the top of match_engineer()
-- (one extra UPDATE per match attempt). For now the function is callable on
-- demand from MatchingClient's sweep effect.
