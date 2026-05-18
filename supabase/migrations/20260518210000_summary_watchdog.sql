-- ============================================================================
-- Relay — Summary watchdog (kills the infinite "Generating…" spinner)
-- ============================================================================
-- pg_cron job runs every minute. Two transitions:
--
--   waiting_for_transcript stuck > 15 min       → transcript_unavailable
--   generating_* stuck         >  5 min         → summary_failed
--
-- The 15-min ceiling matches the worst-case Zoom AI Companion latency we've
-- observed in practice; the 5-min ceiling on generating_* covers OpenAI
-- timeouts and edge-function crashes (Deno worker restarts).
--
-- Once a row hits transcript_unavailable / summary_failed it can be retried
-- by re-invoking summarize-guest-call from the UI (regenerate button).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tick_summary_watchdog()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _count int := 0;
  _rc    int;
BEGIN
  -- Rows that have been waiting too long for a Zoom AI Companion summary
  -- that's clearly not coming. Mark them transcript_unavailable; any chat
  -- summary that summarize-guest-call already produced is preserved.
  UPDATE guest_calls
  SET    summary_state            = 'transcript_unavailable',
         summary_state_updated_at = now(),
         updated_at               = now()
  WHERE  summary_state = 'waiting_for_transcript'
    AND  COALESCE(summary_state_updated_at, ended_at) < now() - interval '15 minutes';

  -- GET DIAGNOSTICS only assigns a single diagnostic item to a single
  -- variable — no expressions on the RHS. We capture each UPDATE's row
  -- count into _rc and accumulate manually.
  GET DIAGNOSTICS _rc = ROW_COUNT;
  _count := _count + _rc;

  -- Rows that were actively generating but the worker never followed through.
  UPDATE guest_calls
  SET    summary_state            = 'summary_failed',
         summary_state_updated_at = now(),
         updated_at               = now()
  WHERE  summary_state IN ('generating_session_summary', 'generating_zoom_summary')
    AND  COALESCE(summary_state_updated_at, ended_at) < now() - interval '5 minutes';

  GET DIAGNOSTICS _rc = ROW_COUNT;
  _count := _count + _rc;

  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.tick_summary_watchdog() TO service_role;

-- Schedule on pg_cron if available. Wrapped in DO / EXCEPTION so the
-- migration succeeds on environments without pg_cron (the Next.js side
-- can invoke this function as a fallback cron route).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'relay-summary-watchdog',
      '* * * * *',
      $cron$SELECT public.tick_summary_watchdog();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;
