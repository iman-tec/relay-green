-- ============================================================================
-- match_engineer v2 trigger fix
-- ============================================================================
-- 20260527120000 rewrote advance_match_on_offer_close to also act on
-- pending → accepted (supersede sibling pending offers). But the trigger
-- BINDING (created in an earlier migration) carries a WHEN guard that
-- restricts firing to old='pending' AND new IN ('declined','expired'). So
-- the new accept branch never fired.
--
-- Drop the WHEN clause. The function body already guards every branch, so
-- letting it run on every status UPDATE is harmless — the extra call cost
-- is one ROW INSERT comparison per offer status change.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS advance_match_on_offer_close_trg ON public.engineer_match_offers;

CREATE TRIGGER advance_match_on_offer_close_trg
  AFTER UPDATE OF status ON public.engineer_match_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_match_on_offer_close();

COMMIT;
