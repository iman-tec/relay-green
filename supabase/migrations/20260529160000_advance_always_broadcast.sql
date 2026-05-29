-- ============================================================================
-- advance_match_on_offer_close: ALWAYS broadcast on decline; manual only
-- when the broadcast finds nobody.
-- ============================================================================
-- Product rule: when an engineer declines/expires, the matcher must
-- automatically broadcast to every other active online engineer. Only once
-- a broadcast turns up NO eligible engineer does the session fall to the
-- supervisor (reassign_needed). Previously a DIRECTED (supervisor-assigned)
-- decline short-circuited straight to reassign_needed, and the supervisor
-- had to click "Broadcast" by hand — exactly the manual step we want to
-- remove. Now every decline (directed or auto) falls through to
-- match_engineer, which:
--   • broadcasts to all eligible online engineers (it's tier-aware: any
--     prior offer on the intake → broadcast), and
--   • sets guest_calls.reassign_needed = true itself when zero engineers
--     are eligible — that's the ONLY path to "manual / supervisor".
--
-- Net flow: best ring → decline → AUTO broadcast → (someone accepts) OR
-- (nobody eligible → reassign_needed → supervisor takes over manually).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_match_on_offer_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Accept → supersede sibling pending offers (first-accept-wins).
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

  -- Session already taken (some offer accepted) → never auto-ring again.
  IF EXISTS (
    SELECT 1 FROM public.engineer_match_offers
     WHERE intake_id = NEW.intake_id
       AND status = 'accepted'
  ) THEN
    RETURN NEW;
  END IF;

  -- NOTE: we intentionally do NOT short-circuit a directed/manual decline to
  -- reassign_needed here anymore. Every decline — auto OR supervisor-assigned
  -- — falls through to match_engineer so the broadcast runs automatically.
  -- match_engineer flips reassign_needed itself when nobody is eligible, so
  -- the supervisor is only pulled in after the broadcast genuinely finds no
  -- one.

  -- Session must still be queued.
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = NEW.guest_call_id
      AND gc.status = 'queued'
  ) THEN
    RETURN NEW;
  END IF;

  -- Don't ring more if an offer is still live (broadcast in progress).
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
