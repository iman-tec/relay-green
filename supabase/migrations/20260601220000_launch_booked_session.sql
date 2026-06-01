-- ============================================================================
-- launch_booked_session: customer clicks "Join" on a scheduled appointment →
-- ring the SPECIFIC booked engineer directly.
-- ============================================================================
-- Unlike the live-call path (/api/match/directed + match_engineer), a scheduled
-- session must reach the exact engineer the customer booked, regardless of:
--   • the engineer's online toggle (the matcher skips offline engineers), and
--   • whether they've had a prior session together (the directed endpoint's
--     prior-relationship guard).
-- So we insert a pending engineer_match_offers row straight for the booked
-- engineer. Their existing EngineerIncomingMatch popup picks it up (it watches
-- their offers whenever the dashboard is open) → Accept → accept_match claims
-- the session → both go live. Intake is auto-created if the customer never
-- started one for this project. Customer-only. Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.launch_booked_session(_booking_id uuid)
RETURNS TABLE(guest_call_id uuid, intake_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me       uuid := auth.uid();
  _bk       public.engineer_bookings;
  _session  public.guest_calls;
  _intake   uuid;
  _other    uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO _bk FROM engineer_bookings
   WHERE id = _booking_id AND customer_user_id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF _bk.status <> 'booked' THEN RAISE EXCEPTION 'BOOKING_NOT_JOINABLE' USING ERRCODE='P0001'; END IF;
  IF _bk.project_id IS NULL THEN RAISE EXCEPTION 'BOOKING_NO_PROJECT' USING ERRCODE='P0001'; END IF;

  -- Cancel any active session the customer has in a DIFFERENT project so
  -- get_or_create returns a fresh session for THIS project.
  FOR _other IN
    SELECT id FROM guest_calls
     WHERE customer_user_id = _me
       AND status IN ('queued','assigned','joining','live','grace','ending','expired_free')
       AND project_id IS DISTINCT FROM _bk.project_id
  LOOP
    PERFORM public.cancel_customer_session(_other);
  END LOOP;

  -- 1. Session for the project (creates a queued guest_call; checks entitlement).
  SELECT * INTO _session FROM public.get_or_create_active_customer_session(_bk.project_id);
  IF _session.id IS NULL THEN RAISE EXCEPTION 'SESSION_FAILED' USING ERRCODE='P0001'; END IF;

  -- 2. Find or create the intake for this customer + project.
  SELECT id INTO _intake FROM client_intakes
   WHERE customer_user_id = _me AND project_id = _bk.project_id
   ORDER BY created_at DESC LIMIT 1;
  IF _intake IS NULL THEN
    INSERT INTO client_intakes (customer_user_id, project_id, guest_call_id, familiarity, ai_tools_used, developing)
    VALUES (_me, _bk.project_id, _session.id, 'Well Experienced', 'Other', 'Other')
    RETURNING id INTO _intake;
  ELSE
    UPDATE client_intakes SET guest_call_id = _session.id, declined_by = '{}'::uuid[]
     WHERE id = _intake;
  END IF;

  -- 3. Ring the booked engineer directly (fresh offer, 120s to accept).
  DELETE FROM engineer_match_offers WHERE intake_id = _intake AND guest_call_id = _session.id;
  INSERT INTO engineer_match_offers (intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score, expires_at)
  VALUES (_intake, _session.id, _bk.engineer_user_id, _me, 0, now() + interval '120 seconds');

  -- 4. Link booking → session, mark launched (so auto-expire won't flag it).
  UPDATE engineer_bookings SET guest_call_id = _session.id, status = 'completed' WHERE id = _booking_id;

  -- 5. Nudge the engineer in case the ring popup isn't on screen.
  PERFORM public.create_notification(_bk.engineer_user_id, NULL, 'appointment_join',
    'Scheduled session starting now', 'Your booked customer just joined — accept the call.');

  guest_call_id := _session.id;
  intake_id := _intake;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.launch_booked_session(uuid) TO authenticated;

COMMIT;
