-- ============================================================================
-- Supervisor drops one of their team engineers' bookings
-- ============================================================================
-- The /schedule surface now shows every pod engineer's customer↔engineer
-- appointment (engineer_bookings) so the supervisor can manage the team's day.
-- cancel_booking_with_reason() only authorises the engineer or the customer,
-- so this adds a supervisor path: the caller must be a supervisor who shares a
-- pod with the booking's engineer. It cancels the slot (recording the reason)
-- and notifies BOTH the engineer and the customer, mirroring the copy/structure
-- of cancel_booking_with_reason().
--
-- Additive: one new SECURITY DEFINER function + GRANT. Nothing dropped.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_cancel_engineer_booking(_id uuid, _reason text)
RETURNS public.engineer_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_bookings;
  _n      record;
  _when   text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO result FROM engineer_bookings WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  -- Authorisation: caller is a supervisor sharing a pod with the engineer.
  IF NOT EXISTS (
    SELECT 1
      FROM pod_members sup
      JOIN pod_members eng ON eng.pod_id = sup.pod_id
     WHERE sup.user_id  = _me
       AND sup.pod_role = 'supervisor'
       AND eng.user_id  = result.engineer_user_id
       AND eng.pod_role = 'engineer'
  ) THEN
    RAISE EXCEPTION 'NOT_YOUR_TEAM' USING ERRCODE='P0001';
  END IF;

  -- Idempotent: only a live booking can be dropped.
  IF result.status <> 'booked' THEN RETURN result; END IF;

  UPDATE engineer_bookings
     SET status = 'cancelled',
         cancel_reason = NULLIF(btrim(COALESCE(_reason, '')), '')
   WHERE id = _id
   RETURNING * INTO result;

  SELECT * INTO _n FROM public.booking_party_names(result);
  _when := to_char(result.slot_start, 'Mon DD, HH24:MI');

  -- Notify the engineer and the customer that the supervisor dropped the slot.
  PERFORM public.create_notification(result.engineer_user_id, NULL, 'appointment_cancelled',
    'Booking dropped by your supervisor',
    'The ' || _when || ' session with ' || _n.customer_name || ' was dropped'
      || COALESCE(' · ' || result.cancel_reason, ''));
  PERFORM public.create_notification(result.customer_user_id, NULL, 'appointment_cancelled',
    'Your ' || _when || ' session was cancelled',
    'A supervisor cancelled your session with ' || _n.engineer_name
      || COALESCE(' · ' || result.cancel_reason, '') || '. You can reschedule.');

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_cancel_engineer_booking(uuid, text) TO authenticated;

COMMIT;
