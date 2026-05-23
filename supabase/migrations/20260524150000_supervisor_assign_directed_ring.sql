-- ============================================================================
-- supervisor_assign_engineer: RING the chosen engineer instead of force-claim
-- ============================================================================
-- Previously a supervisor/admin assignment force-claimed the session for the
-- engineer (set claimed_by + status='assigned' + assigned_at = now()). That
-- meant:
--   • the engineer got no incoming-call popup — the session just appeared, and
--   • billing started instantly at the admin's click, before the engineer had
--     actually joined.
--
-- Per product feedback, an admin assignment must behave like a direct call:
-- it RINGS that specific engineer (a directed pending offer), the engineer
-- gets the same full-screen incoming-call popup (EngineerIncomingMatch), and
-- only when they ACCEPT does accept_match claim the session and stamp
-- assigned_at — which is when billing starts. So the minute counter begins at
-- the engineer's join, not the admin's click.
--
-- The directed offer is created with a generous 60s window. If the engineer
-- doesn't pick up, the existing advance_match cycle takes over and rings the
-- next best engineer, so the customer is never stranded.
-- ============================================================================

BEGIN;

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

  -- Engineer must be free (not already on a live session).
  IF EXISTS (
    SELECT 1 FROM guest_calls
    WHERE claimed_by = _engineer_user_id
      AND status IN ('assigned','joining','live','grace','expired_free','ending')
  ) THEN
    RAISE EXCEPTION 'ENGINEER_BUSY' USING ERRCODE='P0001';
  END IF;

  -- Session must still be ringable (queued — not yet claimed/ended).
  SELECT * INTO _session FROM guest_calls WHERE id = _intake.guest_call_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;
  IF _session.status <> 'queued' THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Directed ring: reuse this engineer's prior offer row for the intake if one
  -- exists (e.g. they declined earlier and the admin is re-ringing them),
  -- otherwise insert a fresh pending offer. accept_match will claim the
  -- session and stamp assigned_at on accept — that's when billing starts.
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

  -- Audit the directed assignment.
  INSERT INTO supervisor_assignments
    (intake_id, guest_call_id, supervisor_user_id, assigned_engineer_id, action)
  VALUES
    (_intake.id, _intake.guest_call_id, _caller, _engineer_user_id, 'assign');

  -- Session is still queued — it becomes 'assigned' (and billing starts) only
  -- when the engineer accepts the ring.
  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_assign_engineer(uuid, uuid) TO authenticated;

COMMIT;
