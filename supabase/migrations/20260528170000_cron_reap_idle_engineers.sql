-- ============================================================================
-- Schedule reap_idle_engineers() on a pg_cron job — every 10 seconds
-- ============================================================================
-- The reaper from 20260528150000_reap_idle_engineers_offline was wired into
-- engineer_heartbeat() and match_engineer() as inline side-effects. That
-- catches the common case (some engineer is heartbeating, or a customer is
-- matching) but FAILS the silent case: a single engineer is logged in, hits
-- Win+L, and nobody else triggers the reaper. Result: while they're at the
-- lock screen, supervisors / customer picker / other engineers all still see
-- them as Online — because nothing actually checks for staleness.
--
-- The user spec requires that within 30 s of going idle, EVERYONE sees the
-- engineer as Offline regardless of whether any other client is active.
-- That demands a server-driven trigger.
--
-- pg_cron (already enabled on this project, v1.6.4) supports sub-minute
-- schedules via the interval syntax. Scheduling reap_idle_engineers() every
-- 10 s gives a worst-case detection window of 30 + 10 = 40 s. The reaper
-- itself is a bounded UPDATE on indexed columns; load is negligible.
--
-- The inline reap calls in engineer_heartbeat / match_engineer are kept as
-- defence-in-depth — they still fire immediately on client activity, the
-- cron is only the fallback for true silence.
-- ============================================================================

BEGIN;

-- Idempotent: drop any prior job with the same name before re-scheduling.
-- (No error if the job doesn't exist — the SELECT just returns zero rows.)
SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname = 'reap_idle_engineers';

-- Schedule every 10 seconds.
SELECT cron.schedule(
  'reap_idle_engineers',
  '10 seconds',
  $job$ SELECT public.reap_idle_engineers(); $job$
);

COMMIT;
