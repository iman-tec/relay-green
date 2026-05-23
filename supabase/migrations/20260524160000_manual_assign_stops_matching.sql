-- ============================================================================
-- Manual assignment stops the automatic matcher
-- ============================================================================
-- When a supervisor / super_admin directs a session to a specific engineer
-- (supervisor_assign_engineer → a targeted ring), the ongoing automatic
-- sequential matching must STOP — only the chosen engineer should be ringing,
-- not the auto-matched ones in parallel.
--
-- Two changes:
--   1. advance_match_on_offer_close: when an offer closes, do NOT ring the
--      next engineer if a valid pending offer already exists for the intake.
--      This keeps the targeted ring from being overridden, and is a sound
--      invariant in general (never ring two engineers for one session at once).
--   2. supervisor_assign_engineer: after creating the targeted offer, expire
--      every OTHER pending offer for the intake. Each expiry fires the trigger
--      above, which now no-ops because the targeted offer is still pending —
--      so the auto-matcher goes quiet and only the chosen engineer rings.
--
-- Fallback is preserved: if the chosen engineer lets the targeted offer expire
-- without accepting, advance_match then finds no pending offer and rings the
-- next best engineer, so the customer is never stranded.
-- ============================================================================

BEGIN;

-- ── 1. advance_match_on_offer_close: skip if someone is already being rung ───
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

  -- Session must still be queued (no engineer claimed, not cancelled/abandoned).
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = NEW.guest_call_id
      AND gc.status = 'queued'
  ) THEN
    RETURN NEW;
  END IF;

  -- Don't ring another engineer if one is already being rung for this intake
  -- (e.g. a supervisor directed-assign created a targeted offer). Prevents the
  -- auto-matcher from competing with / overriding a manual assignment, and
  -- enforces one-pending-offer-at-a-time generally.
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

-- (Trigger definition unchanged — still bound to this function.)

-- ── 2. supervisor_assign_engineer: silence the auto-ring on manual assign ────
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

  -- Targeted ring for the chosen engineer (reuse their prior row if any).
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
           offered_at       = now(),
           expires_at       = now() + interval '60 seconds',
           responded_at     = NULL
     WHERE id = _existing_offer;
  ELSE
    INSERT INTO engineer_match_offers (
      intake_id, guest_call_id, engineer_user_id, customer_user_id,
      status, match_score, offered_at, expires_at
    ) VALUES (
      _intake.id, _intake.guest_call_id, _engineer_user_id, _intake.customer_user_id,
      'pending', 0, now(), now() + interval '60 seconds'
    );
  END IF;

  -- Stop the automatic matcher: expire every OTHER pending offer for this
  -- intake. The advance trigger fires per row but no-ops because the targeted
  -- offer above is still pending — so no replacement engineer gets rung.
  UPDATE engineer_match_offers
     SET status = 'expired', responded_at = now()
   WHERE intake_id = _intake.id
     AND status = 'pending'
     AND engineer_user_id <> _engineer_user_id;

  INSERT INTO supervisor_assignments
    (intake_id, guest_call_id, supervisor_user_id, assigned_engineer_id, action)
  VALUES
    (_intake.id, _intake.guest_call_id, _caller, _engineer_user_id, 'assign');

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_assign_engineer(uuid, uuid) TO authenticated;

COMMIT;
