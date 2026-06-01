-- ============================================================================
-- Add engineer → RING them (don't pre-assign)
-- ============================================================================
-- Previously add_engineer_to_appointment directly stamped the session
-- claimed_by/assigned, which (a) gave the engineer no incoming-call ring and
-- (b) made the customer joinable the instant the supervisor assigned — before
-- the engineer was actually coming.
--
-- New behaviour: place a DIRECTED push-ring at the chosen engineer
-- (engineer_match_offers) on the appointment session, exactly like the normal
-- matcher's single-engineer offer. The engineer's incoming-call popup fires;
-- on Accept, accept_match claims the (still-queued) session → assigned, and only
-- THEN does the customer's "Join" light up. No pre-assignment.
--
-- Needs a client_intakes row (the ring UI joins it); we create a minimal one for
-- the appointment session if absent. Replaces the RPC body only.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.add_engineer_to_appointment(
  _booking_id       uuid,
  _engineer_user_id uuid
)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me       uuid := auth.uid();
  _eng_name text;
  _intake   uuid;
  result    public.supervisor_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM supervisor_bookings
   WHERE id = _booking_id
     AND supervisor_user_id = _me
     AND status = 'booked'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_YOUR_APPOINTMENT' USING ERRCODE='P0001';
  END IF;
  IF result.call_started_at IS NULL THEN
    RAISE EXCEPTION 'CALL_NOT_STARTED' USING ERRCODE='P0001';
  END IF;
  IF result.session_id IS NULL THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM guest_calls g
     WHERE g.project_id = result.project_id
       AND g.claimed_by = _engineer_user_id
       AND g.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'ENGINEER_NOT_ON_PROJECT' USING ERRCODE='P0001';
  END IF;

  SELECT full_name INTO _eng_name FROM profiles WHERE id = _engineer_user_id;

  UPDATE supervisor_bookings
     SET engineer_invited_id   = _engineer_user_id,
         engineer_invited_at   = now(),
         engineer_invited_name = _eng_name
   WHERE id = _booking_id
   RETURNING * INTO result;

  -- The ring UI (EngineerIncomingMatch) joins client_intakes — ensure one
  -- exists for the appointment session.
  SELECT id INTO _intake FROM client_intakes
   WHERE guest_call_id = result.session_id
   LIMIT 1;
  IF _intake IS NULL THEN
    INSERT INTO client_intakes (
      guest_call_id, customer_user_id, familiarity, ai_tools_used, developing
    ) VALUES (
      result.session_id, result.customer_user_id, 'Semi-Technical', '', 'Website'
    )
    RETURNING id INTO _intake;
  END IF;

  -- Clear any stale pending offers for this intake, then ring the chosen
  -- engineer with a generous window (appointments aren't a hot queue).
  UPDATE engineer_match_offers
     SET status = 'expired', responded_at = now()
   WHERE intake_id = _intake AND status = 'pending';

  INSERT INTO engineer_match_offers (
    intake_id, guest_call_id, engineer_user_id, status, expires_at
  ) VALUES (
    _intake, result.session_id, _engineer_user_id, 'pending', now() + interval '2 minutes'
  );

  -- Backup notification (in case they aren't on a staff page to catch the ring).
  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _engineer_user_id, result.quote_id, 'appointment_engineer_added',
    'Incoming appointment call',
    'You''re being rung for a call'
      || COALESCE(' about ' || result.project_name, '')
      || COALESCE(' with ' || result.customer_name, '') || ' — accept to join'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.add_engineer_to_appointment(uuid, uuid) TO authenticated;

COMMIT;
