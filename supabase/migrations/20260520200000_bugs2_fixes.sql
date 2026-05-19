-- ============================================================================
-- bugs2.txt fixes — list_queue isolation, 90s match timeout, sentiment persistence
-- ============================================================================
--
-- Bug #4 — Engineers seeing calls meant for other engineers.
--   Root cause: list_queue() returns ALL queued guest_calls. When the new
--   /intake → match_engineer pipeline creates an offer for ONE engineer,
--   the underlying guest_calls row is still 'queued', so every engineer
--   sees a Join button. Fix: filter out queued rows with an open match
--   offer.
--
-- Bug #5 — Ringing timeout 30s → 90s.
--   Root cause: match_engineer set expires_at = now() + 30s.
--   Fix: bump to 90s. The matching-screen countdown and engineer
--   incoming-match countdown both derive from this column, so they pick
--   up the new value automatically.
--
-- Bug #3 — Sentiment persistence (defensive copy on guest_calls).
--   The fundamental fix is in supabase/functions/summarize-guest-call,
--   which was skipping the post-end sentiment write. As belt-and-braces,
--   add final_sentiment_score + final_sentiment_summary columns directly
--   on guest_calls so the supervisor PastSessionTile can fall back to
--   the row itself if latest_session_health is empty for any reason.
-- ============================================================================

BEGIN;

-- ── Bug #4: list_queue excludes rows with an open match offer ──────────────
CREATE OR REPLACE FUNCTION public.list_queue()
RETURNS SETOF public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(auth.uid(),'engineer') OR has_role(auth.uid(),'pod_lead') OR
          has_role(auth.uid(),'ops_manager') OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
  SELECT gc.* FROM guest_calls gc
   WHERE gc.status = 'queued'
     -- Hide sessions that are currently being offered to a specific
     -- engineer via match_engineer. Once the offer is declined/expired,
     -- the session re-appears in the open queue (so a customer who hits
     -- "Skip" doesn't leave their session orphaned).
     AND NOT EXISTS (
       SELECT 1 FROM engineer_match_offers o
       WHERE o.guest_call_id = gc.id
         AND o.status IN ('pending','accepted')
         AND o.expires_at > now()
     )
   ORDER BY
     CASE gc.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
     gc.created_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.list_queue() TO authenticated;


-- ── Bug #5: 90s ring timeout ───────────────────────────────────────────────
-- The column default is the only thing match_engineer relies on for the
-- offer expiry, so a single DEFAULT change carries the whole flow.
ALTER TABLE public.engineer_match_offers
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 seconds');


-- ── Bug #3: defensive sentiment copy on guest_calls ────────────────────────
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS final_sentiment_score   numeric,
  ADD COLUMN IF NOT EXISTS final_sentiment_summary text;

-- One-time backfill: copy the LATEST session_health row's score/summary
-- onto every already-ended guest_call so historical sessions get
-- sentiment back. Future sessions are populated by summarize-guest-call.
UPDATE public.guest_calls gc
SET    final_sentiment_score   = lsh.score,
       final_sentiment_summary = lsh.summary
FROM   public.latest_session_health lsh
WHERE  lsh.session_id = gc.id
  AND  gc.status = 'ended'
  AND  gc.final_sentiment_score IS NULL;

COMMIT;
