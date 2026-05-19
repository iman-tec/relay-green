-- ============================================================================
-- Auto-expire match offers when their session leaves 'queued'/'assigned'
-- ============================================================================
-- Symptom: customer hits Cancel in the MatchingModal → session is
-- cancelled, but the engineer's ring modal stays up because the
-- engineer_match_offers row is still status='pending' until its 90s
-- TTL hits. Engineer keeps seeing the ring for a stranded call.
--
-- Fix: when guest_calls.status transitions into a terminal state
-- (cancelled / abandoned / ended), force-expire every pending offer
-- pointing at that session. The trigger uses SECURITY DEFINER so the
-- UPDATE inside bypasses RLS regardless of which RPC / client did the
-- status flip.
--
-- The same mechanism cleans up after the abandon-stale-queued cron and
-- end_session, not just cancel_customer_session — every status flip is
-- covered.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.expire_offers_on_session_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('cancelled','abandoned','ended')
     AND OLD.status NOT IN ('cancelled','abandoned','ended') THEN
    UPDATE public.engineer_match_offers
       SET status='expired', responded_at=now()
     WHERE guest_call_id = NEW.id
       AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS expire_offers_on_session_terminal_trg ON public.guest_calls;
CREATE TRIGGER expire_offers_on_session_terminal_trg
  AFTER UPDATE OF status ON public.guest_calls
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.expire_offers_on_session_terminal();

COMMIT;
