-- ============================================================================
-- Relay — Shorten waiting_for_transcript watchdog from 15 min to 5 min
-- ============================================================================
-- Supersedes 20260518210000_summary_watchdog.sql. The 15-min ceiling was too
-- long for the user-facing case where Zoom was joined but recording was
-- never started — that session sits in "waiting_for_transcript" with no
-- AI Companion summary on the way, and the UX feels stuck.
--
-- summarize-guest-call now short-circuits to transcript_unavailable inline
-- when it can prove recording was off (meeting.ended > 60s old, no
-- recording_play_url). This watchdog catches the residual case where the
-- inline check wasn't conclusive (e.g. meeting.ended webhook delivery
-- delayed > 60s past summarize-guest-call's first run).
--
-- Failed-generation ceiling stays at 5 min — same intent, just unified.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tick_summary_watchdog()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _count int := 0;
  _rc    int;
BEGIN
  UPDATE guest_calls
  SET    summary_state            = 'transcript_unavailable',
         summary_state_updated_at = now(),
         updated_at               = now()
  WHERE  summary_state = 'waiting_for_transcript'
    AND  COALESCE(summary_state_updated_at, ended_at) < now() - interval '5 minutes';

  GET DIAGNOSTICS _rc = ROW_COUNT;
  _count := _count + _rc;

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
