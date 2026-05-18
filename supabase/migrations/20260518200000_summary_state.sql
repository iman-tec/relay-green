-- ============================================================================
-- Relay — Summary state machine on guest_calls
-- ============================================================================
-- Replaces the implicit "spinner if summary IS NULL" check with an explicit
-- enum. Lets the UI render distinct copy for each lifecycle stage and gives
-- a pg_cron watchdog something to look at when stalled (see the watchdog
-- migration that follows). States:
--
--   idle                         pre-end; no summary work pending
--   generating_session_summary   summarize-guest-call is running now
--   waiting_for_transcript       session ended; Zoom recording was started
--                                but AI Companion summary hasn't landed yet
--   generating_zoom_summary      recording.completed arrived; AI Companion
--                                summary expected within minutes
--   summary_ready                final summary present and trustworthy
--   summary_failed               OpenAI / pipeline error — retryable
--   no_conversation              session ended with no chat AND no Zoom
--                                content (chat-only with no messages, or
--                                Zoom never recorded). UI shows
--                                "No conversation happened" copy.
--   transcript_unavailable       Zoom recording was started but the
--                                AI Companion summary never landed within
--                                the watchdog window. Chat-only summary
--                                may still be present.
--
-- Backfill is conservative: any existing 'ended' row with a populated
-- summary is marked summary_ready; anything else stays idle and will be
-- picked up by the watchdog or a manual rerun.
-- ============================================================================

BEGIN;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS summary_state            text        NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS summary_state_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.guest_calls
    ADD CONSTRAINT guest_calls_summary_state_chk
    CHECK (summary_state IN (
      'idle',
      'generating_session_summary',
      'waiting_for_transcript',
      'generating_zoom_summary',
      'summary_ready',
      'summary_failed',
      'no_conversation',
      'transcript_unavailable'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill — existing ended rows.
UPDATE public.guest_calls
SET    summary_state            = 'summary_ready',
       summary_state_updated_at = COALESCE(summary_state_updated_at, ended_at, now())
WHERE  status = 'ended'
  AND  summary IS NOT NULL
  AND  summary <> ''
  AND  summary NOT ILIKE 'Awaiting%'
  AND  summary_state = 'idle';

-- Rows that were stuck on the old "Awaiting AI Companion summary…" placeholder
-- get reset to waiting_for_transcript so the watchdog can resolve them.
UPDATE public.guest_calls
SET    summary_state            = 'waiting_for_transcript',
       summary_state_updated_at = COALESCE(summary_state_updated_at, ended_at, now())
WHERE  status = 'ended'
  AND  summary ILIKE 'Awaiting%'
  AND  summary_state = 'idle';

-- Index for the watchdog scan: only the pending states matter, so a partial
-- index keeps the work proportional to pending count, not table size.
CREATE INDEX IF NOT EXISTS idx_guest_calls_summary_state_pending
  ON public.guest_calls (summary_state_updated_at)
  WHERE summary_state IN (
    'generating_session_summary',
    'waiting_for_transcript',
    'generating_zoom_summary'
  );

COMMIT;
