-- ============================================================================
-- add_engineer_to_appointment: allow ANY engineer (not just project veterans)
-- ============================================================================
-- The supervisor could only add an engineer who had already worked the booking's
-- project (ENGINEER_NOT_ON_PROJECT), so for a fresh project the appointment card
-- offered nobody — while the Matching board happily assigns any engineer on the
-- platform (_can_manually_assign). This brings the appointment add-engineer flow
-- to parity: a supervisor may ring ANY engineer. The target is still validated as
-- an actual engineer, and the caller must own the booking.
--
-- Everything else (directed push-ring via engineer_match_offers + the intake
-- backfill + the notification) is preserved. Replaces the RPC body only.
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

  -- Any engineer may be pulled in (matches the Matching board's manual assign).
  -- We only require that the target is actually an engineer.
  IF NOT public.has_role(_engineer_user_id, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
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
