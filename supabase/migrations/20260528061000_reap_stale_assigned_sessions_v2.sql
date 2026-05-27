-- ============================================================================
-- Reaper v2: also catch "engineer accepted but never actually joined"
-- ============================================================================
-- v1 (20260528060000) only reaped rows where the engineer had no recent
-- heartbeat. That misses the much more common case: the engineer accepted a
-- match, then closed the tab / navigated to /dashboard before the CallSurface
-- mounted. They're still heartbeating from wherever they are, so v1's
-- "engineer is alive" check keeps the row alive — even though `joined_at` is
-- still null an hour later.
--
-- v2 reaps on EITHER condition (additive):
--
--   ( assigned_at < now() - interval '60 seconds'
--     AND joined_at IS NULL )                        -- never made it to the call
--   OR
--   ( assigned_at < now() - interval '60 seconds'
--     AND NOT EXISTS (heartbeat in last 60s) )       -- v1 path, kept
--
-- Same target statuses ('assigned' / 'joining'), same terminal state
-- ('abandoned'). 'live' and 'grace' still off-limits.
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
     AND (
       -- Engineer accepted but never actually opened the call surface.
       gc.joined_at IS NULL
       OR
       -- Or: heartbeat truly gone, regardless of joined_at state.
       NOT EXISTS (
         SELECT 1
           FROM public.engineer_presence p
          WHERE p.engineer_id = gc.claimed_by
            AND p.last_seen_at > now() - interval '60 seconds'
       )
     );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

-- Best-effort cleanup of anything currently stuck under the new criteria.
SELECT public.reap_stale_assigned_sessions();

COMMIT;
