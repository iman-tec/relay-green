-- ============================================================================
-- Declined manual assignment → hand back to the supervisor to reassign
-- ============================================================================
-- When a supervisor/super_admin directs a session to a specific engineer and
-- that engineer DECLINES, the session must come back to the supervisor — they
-- get notified and pick another engineer — rather than silently auto-ringing
-- the next best engineer (which is the right behaviour for a normal automatic
-- decline, just not for a deliberate manual assignment).
--
--   engineer_match_offers.assigned_by   the supervisor who directed the offer
--                                       (NULL for ordinary auto-matched offers)
--   guest_calls.reassign_needed         true when a directed offer was declined
--                                       and the session is awaiting a manual
--                                       reassignment; the supervise grid shows
--                                       these with a Reassign control + a toast
--
-- advance_match_on_offer_close: a DECLINED directed offer sets reassign_needed
-- and stops (no auto-advance). A directed offer that merely EXPIRES (engineer
-- never answered) still falls through to the normal next-engineer ring so the
-- customer isn't stranded. supervisor_assign_engineer stamps assigned_by and
-- clears reassign_needed when (re)assigning.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_match_offers
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS reassign_needed boolean NOT NULL DEFAULT false;

-- ── advance_match_on_offer_close: directed decline → supervisor reassign ─────
CREATE OR REPLACE FUNCTION public.advance_match_on_offer_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('declined', 'expired') THEN
    RETURN NEW;
  END IF;

  -- A DIRECTED (manual) assignment the engineer DECLINED: hand the session
  -- back to the supervisor for reassignment instead of auto-ringing the next
  -- engineer. (A directed offer that merely expired falls through to the
  -- normal cycle below so the customer keeps moving.)
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

-- ── supervisor_assign_engineer: stamp assigned_by + clear reassign flag ──────
CREATE OR REPLACE FUNCTION public.supervisor_assign_engineer(
  _intake_id        uuid,
  _engineer_user_id uuid
)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _caller         uuid := auth.uid();
  _intake         public.client_intakes;
  _session        public.guest_calls;
  _existing_offer uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT public._can_manually_assign(_caller, _engineer_user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_engineer_user_id, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM guest_calls
    WHERE claimed_by = _engineer_user_id
      AND status IN ('assigned','joining','live','grace','expired_free','ending')
  ) THEN
    RAISE EXCEPTION 'ENGINEER_BUSY' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _session FROM guest_calls WHERE id = _intake.guest_call_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;
  IF _session.status <> 'queued' THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Targeted ring for the chosen engineer (reuse their prior row if any),
  -- stamped with assigned_by so a decline routes back here.
  SELECT id INTO _existing_offer
    FROM engineer_match_offers
   WHERE intake_id = _intake.id AND engineer_user_id = _engineer_user_id
   ORDER BY offered_at DESC
   LIMIT 1;

  IF _existing_offer IS NOT NULL THEN
    UPDATE engineer_match_offers
       SET status           = 'pending',
           guest_call_id    = _intake.guest_call_id,
           customer_user_id = _intake.customer_user_id,
           assigned_by      = _caller,
           offered_at       = now(),
           expires_at       = now() + interval '60 seconds',
           responded_at     = NULL
     WHERE id = _existing_offer;
  ELSE
    INSERT INTO engineer_match_offers (
      intake_id, guest_call_id, engineer_user_id, customer_user_id,
      status, match_score, assigned_by, offered_at, expires_at
    ) VALUES (
      _intake.id, _intake.guest_call_id, _engineer_user_id, _intake.customer_user_id,
      'pending', 0, _caller, now(), now() + interval '60 seconds'
    );
  END IF;

  -- Stop the automatic matcher: expire every OTHER pending offer for this
  -- intake (advance trigger no-ops while the targeted offer is pending). Also
  -- clear any prior reassign flag — we're actively (re)assigning now.
  UPDATE engineer_match_offers
     SET status = 'expired', responded_at = now()
   WHERE intake_id = _intake.id
     AND status = 'pending'
     AND engineer_user_id <> _engineer_user_id;

  UPDATE guest_calls
     SET reassign_needed = false, updated_at = now()
   WHERE id = _intake.guest_call_id;

  INSERT INTO supervisor_assignments
    (intake_id, guest_call_id, supervisor_user_id, assigned_engineer_id, action)
  VALUES
    (_intake.id, _intake.guest_call_id, _caller, _engineer_user_id, 'assign');

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_assign_engineer(uuid, uuid) TO authenticated;

COMMIT;
