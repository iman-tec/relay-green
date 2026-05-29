-- ============================================================================
-- Make reap_idle_engineers race-safe against concurrent set_engineer_presence
-- ============================================================================
-- Symptom: at call-end the engineer's ball briefly shows online, then
-- suddenly flips to offline.
--
-- Trace:
--   1. Call ends → client auto-watcher calls set_engineer_presence('online').
--      That refreshes engineer_presence (last_seen_at=now()) AND flips
--      engineer_profiles to presence_state='online' in ONE transaction (T2).
--   2. The cron reaper (T1) — scheduled every 10s — fires concurrently.
--      Its CTE evaluates `stale` from a snapshot taken BEFORE T2 committed:
--        ep.presence_state='busy', last_seen_at >30s old, no active call.
--      So the engineer ends up in T1's stale set.
--   3. T1's UPDATE then says `WHERE ep.user_id = stale.user_id`. That
--      WHERE is just the PK join — it does NOT re-check staleness. PG's
--      EvalPlanQual re-evaluates the WHERE against the latest committed
--      version of the row when acquiring the row lock, but since the WHERE
--      contains no staleness predicate, there's nothing to re-check.
--   4. So T1 overwrites the row to 'offline' EVEN THOUGH T2 just flipped
--      it to 'online'. The realtime publication delivers both events in
--      commit order: online → offline. The ball flickers green then grey.
--
-- Fix: collapse the CTE-then-UPDATE pattern into a SINGLE UPDATE whose
-- WHERE clause contains the full staleness predicate. EvalPlanQual then
-- re-evaluates the entire qualification against the latest committed state
-- when acquiring the row lock. If T2 committed in between, the row's
-- presence_state is 'online' and engineer_presence.last_seen_at is fresh —
-- the re-check fails, the UPDATE skips this row, and the engineer stays
-- online.
--
-- Functional behaviour is unchanged in the absence of races. The change is
-- purely an atomicity tightening.
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
  -- One statement: predicate goes in the WHERE so EvalPlanQual re-checks
  -- it against the latest committed row + related-table state on lock
  -- acquisition. Eliminates the read-snapshot vs commit-order race that
  -- a CTE-then-UPDATE pattern introduces.
  WITH flipped AS (
    UPDATE public.engineer_profiles ep
       SET presence_state = 'offline',
           is_available   = false,
           updated_at     = now()
     WHERE ep.presence_state IN ('online', 'busy')
       AND (
         -- No engineer_presence row at all (never heartbeated since
         -- their last full reset) — treat as stale.
         NOT EXISTS (
           SELECT 1 FROM public.engineer_presence pres
            WHERE pres.engineer_id = ep.user_id
         )
         -- Or the row exists but last_seen_at is older than 30s.
         OR EXISTS (
           SELECT 1 FROM public.engineer_presence pres
            WHERE pres.engineer_id = ep.user_id
              AND pres.last_seen_at < now() - interval '30 seconds'
         )
       )
       -- Skip engineers currently on a live call. reap_stale_assigned_sessions
       -- (60s threshold) takes care of true browser-death; this function only
       -- handles the "not on a call but went silent" case.
       AND NOT EXISTS (
         SELECT 1 FROM public.guest_calls gc
          WHERE gc.claimed_by = ep.user_id
            AND gc.status IN ('assigned', 'joining', 'live', 'grace')
       )
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
