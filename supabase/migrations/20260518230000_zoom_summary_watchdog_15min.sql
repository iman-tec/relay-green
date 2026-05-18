-- ============================================================================
-- Relay — Unified 5-min summary watchdog, with correct terminal states
-- ============================================================================
-- Supersedes 20260518220000_summary_watchdog_5min.sql.
--
-- All three pending states time out at 5 min — that matches the upper
-- bound of Zoom AI Companion delivery (typically 1-2 min) and our own
-- OpenAI call (sub-minute). What changes is the TERMINAL state per
-- pending state, because the meaning is different:
--
--   waiting_for_transcript          → transcript_unavailable
--       recording.completed never landed. Zoom didn't record / didn't
--       deliver. The UI shows the gray "Zoom summary unavailable" copy.
--
--   generating_session_summary      → summary_failed
--       OUR pipeline crashed — OpenAI errored, edge function timed out,
--       Deno worker died. UI shows the red "Couldn't generate" copy +
--       retry button. Retry is meaningful here.
--
--   generating_zoom_summary         → transcript_unavailable
--       Recording landed but Zoom AI Companion never delivered the
--       meeting.summary_completed webhook within 5 min. Could be that
--       Zoom didn't generate a summary at all (silent / very short
--       call) or delivery dropped. UI shows the gray "Zoom summary
--       unavailable" copy — retry wouldn't help, since the missing
--       signal is on Zoom's side, not ours.
--
-- If Zoom AI Companion eventually arrives AFTER this watchdog flipped
-- the row, the webhook re-invokes summarize-guest-call, transcript is
-- populated, and the state self-heals to summary_ready.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tick_summary_watchdog()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _count int := 0;
  _rc    int;
BEGIN
  -- recording.completed never arrived → Zoom didn't record OR webhook dropped.
  UPDATE guest_calls
  SET    summary_state            = 'transcript_unavailable',
         summary_state_updated_at = now(),
         updated_at               = now()
  WHERE  summary_state = 'waiting_for_transcript'
    AND  COALESCE(summary_state_updated_at, ended_at) < now() - interval '5 minutes';

  GET DIAGNOSTICS _rc = ROW_COUNT;
  _count := _count + _rc;

  -- OUR summarizer is the one that hung — retry is the right next step.
  UPDATE guest_calls
  SET    summary_state            = 'summary_failed',
         summary_state_updated_at = now(),
         updated_at               = now()
  WHERE  summary_state = 'generating_session_summary'
    AND  COALESCE(summary_state_updated_at, ended_at) < now() - interval '5 minutes';

  GET DIAGNOSTICS _rc = ROW_COUNT;
  _count := _count + _rc;

  -- Recording exists but Zoom AI Companion didn't deliver. Not our pipeline
  -- failing — Zoom didn't summarize (or delivery dropped). transcript_unavailable
  -- is the accurate terminal: the artifact is missing, retry won't change it.
  UPDATE guest_calls
  SET    summary_state            = 'transcript_unavailable',
         summary_state_updated_at = now(),
         updated_at               = now()
  WHERE  summary_state = 'generating_zoom_summary'
    AND  COALESCE(summary_state_updated_at, ended_at) < now() - interval '5 minutes';

  GET DIAGNOSTICS _rc = ROW_COUNT;
  _count := _count + _rc;

  RETURN _count;
END $$;
