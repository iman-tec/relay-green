-- ============================================================================
-- Fix: launch_booked_session failed with "column reference intake_id is
-- ambiguous" — the RETURNS TABLE OUT params (intake_id, guest_call_id) shadow
-- the engineer_match_offers columns of the same name in the DELETE's WHERE.
-- Qualify those column references with the table name. (CREATE OR REPLACE keeps
-- the same signature.)
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

  FOR _other IN
    SELECT id FROM guest_calls
     WHERE customer_user_id = _me
       AND status IN ('queued','assigned','joining','live','grace','ending','expired_free')
       AND project_id IS DISTINCT FROM _bk.project_id
  LOOP
    PERFORM public.cancel_customer_session(_other);
  END LOOP;

  SELECT * INTO _session FROM public.get_or_create_active_customer_session(_bk.project_id);
  IF _session.id IS NULL THEN RAISE EXCEPTION 'SESSION_FAILED' USING ERRCODE='P0001'; END IF;

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

  -- Qualified column names so they don't collide with the OUT params above.
  DELETE FROM engineer_match_offers
   WHERE engineer_match_offers.intake_id = _intake
     AND engineer_match_offers.guest_call_id = _session.id;
  INSERT INTO engineer_match_offers (intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score, expires_at)
  VALUES (_intake, _session.id, _bk.engineer_user_id, _me, 0, now() + interval '120 seconds');

  UPDATE engineer_bookings SET guest_call_id = _session.id, status = 'completed' WHERE id = _booking_id;

  PERFORM public.create_notification(_bk.engineer_user_id, NULL, 'appointment_join',
    'Scheduled session starting now', 'Your booked customer just joined — accept the call.');

  guest_call_id := _session.id;
  intake_id := _intake;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.launch_booked_session(uuid) TO authenticated;

COMMIT;
