-- ============================================================================
-- list_queue: hide every authenticated-customer session
-- ============================================================================
-- bugs2.txt #4 already excluded queued sessions with an open match-offer
-- (pending/accepted, expires_at > now()). The hole: once a 90-second offer
-- expires without acceptance, the session becomes visible to every engineer
-- in the legacy queue. The customer observes this as "the call went to
-- everyone" after they wait or hit Skip on the matching screen.
--
-- Stronger invariant: an authenticated customer's session is ALWAYS routed
-- via the push-ring (engineer_match_offers). It never appears in the open
-- pull queue regardless of whether a current offer exists. The legacy
-- list_queue is now strictly for anonymous /room visitors (no login).
-- ============================================================================

BEGIN;

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
     -- Authenticated customer sessions are push-ring routed (match_engineer
     -- → engineer_match_offers). They never appear in this pull queue —
     -- even when the current offer has expired, because the customer's
     -- next action ("Find Another" or "Back to Home") will either create
     -- a fresh offer or cancel the session.
     --
     -- Only anonymous /room visitors (no login → customer_user_id IS NULL)
     -- still flow through here.
     AND gc.customer_user_id IS NULL
   ORDER BY
     CASE gc.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
     gc.created_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.list_queue() TO authenticated;

COMMIT;
