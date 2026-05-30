-- ============================================================================
-- advance_match_on_offer_close: scope the "taken / already ringing" guards to
-- the CURRENT call, not the whole (reused) intake
-- ============================================================================
-- Bug: an intake is reused across many calls, but this trigger's guards keyed
-- on intake_id alone. After ANY engineer accepted a call on an intake, the
-- accepted offer lingered in engineer_match_offers. On the NEXT call, when the
-- first engineer DECLINED, the trigger's "is any offer accepted for this
-- intake?" guard matched that STALE accepted offer, concluded the session was
-- already taken, and returned WITHOUT calling match_engineer. Result:
--   • the next engineer was never rung (no tier-2 offer created), and
--   • reassign_needed was never set (it's only set inside match_engineer),
--     so the supervisor had nothing to assign.
--
-- Fix: scope the accept-supersede, the "accepted exists" guard, and the
-- "already ringing" pending guard to (intake_id, guest_call_id) so offers from
-- previous calls on the same intake are ignored. match_engineer is already
-- call-scoped. Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_match_on_offer_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Accept → supersede sibling pending offers FOR THE SAME CALL.
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    UPDATE public.engineer_match_offers
       SET status       = 'expired',
           responded_at = now()
     WHERE intake_id     = NEW.intake_id
       AND guest_call_id = NEW.guest_call_id
       AND id           <> NEW.id
       AND status        = 'pending';
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('declined', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Already accepted FOR THIS CALL → taken, stop. (Scoped to guest_call_id so a
  -- stale accepted offer from a previous call on this reused intake can't block
  -- forwarding for the current call.)
  IF EXISTS (
    SELECT 1 FROM public.engineer_match_offers
     WHERE intake_id     = NEW.intake_id
       AND guest_call_id = NEW.guest_call_id
       AND status        = 'accepted'
  ) THEN
    RETURN NEW;
  END IF;

  -- The call must still be queued.
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = NEW.guest_call_id
      AND gc.status = 'queued'
  ) THEN
    RETURN NEW;
  END IF;

  -- Someone is still actively ringing FOR THIS CALL → don't double-ring.
  IF EXISTS (
    SELECT 1 FROM public.engineer_match_offers o
    WHERE o.intake_id     = NEW.intake_id
      AND o.guest_call_id = NEW.guest_call_id
      AND o.status        = 'pending'
      AND o.expires_at    > now()
  ) THEN
    RETURN NEW;
  END IF;

  -- Ring the next eligible engineer (tier escalation) / flag reassign if none.
  PERFORM public.match_engineer(NEW.intake_id);
  RETURN NEW;
END $$;

COMMIT;
