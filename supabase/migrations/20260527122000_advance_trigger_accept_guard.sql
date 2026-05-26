-- ============================================================================
-- advance_match_on_offer_close: add an "any accepted?" guard
-- ============================================================================
-- The accept-branch in 20260527120000 expires every sibling pending offer
-- when one is accepted. That cascade of UPDATEs re-fires this same trigger
-- on each sibling row (now pending→expired). For the LAST sibling, by the
-- time the trigger inspects "any pending offers for this intake?" the answer
-- is no — and the old logic happily calls match_engineer() to ring yet
-- another engineer for a session that's already taken.
--
-- Fix: before falling through to the "ring next" path, also check if there
-- is ALREADY an accepted offer for this intake. If so, the session is
-- taken; stop. Harmless on the natural single-decline path (no accepted row
-- exists in that scenario), but kills the spurious ring after fan-out
-- supersession.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_match_on_offer_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Accept → supersede sibling pending offers (fan-out first-accept-wins).
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    UPDATE public.engineer_match_offers
       SET status       = 'expired',
           responded_at = now()
     WHERE intake_id        = NEW.intake_id
       AND id              <> NEW.id
       AND status           = 'pending';
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('declined', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Guard: if any offer for this intake has already been accepted, the
  -- session is taken — never auto-ring more engineers, even if the last
  -- pending sibling is expiring as part of the supersession cascade.
  IF EXISTS (
    SELECT 1 FROM public.engineer_match_offers
     WHERE intake_id = NEW.intake_id
       AND status = 'accepted'
  ) THEN
    RETURN NEW;
  END IF;

  -- Directed (manual) decline → hand back to supervisor for reassignment.
  IF NEW.status = 'declined' AND OLD.assigned_by IS NOT NULL THEN
    UPDATE public.guest_calls
       SET reassign_needed = true, updated_at = now()
     WHERE id = NEW.guest_call_id
       AND status = 'queued';
    RETURN NEW;
  END IF;

  -- Session must still be queued.
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = NEW.guest_call_id
      AND gc.status = 'queued'
  ) THEN
    RETURN NEW;
  END IF;

  -- Don't ring another engineer if one is already being rung for this intake.
  IF EXISTS (
    SELECT 1 FROM public.engineer_match_offers o
    WHERE o.intake_id = NEW.intake_id
      AND o.status = 'pending'
      AND o.expires_at > now()
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.match_engineer(NEW.intake_id);
  RETURN NEW;
END $$;

COMMIT;
