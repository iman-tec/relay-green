-- ============================================================================
-- mark_booking_launched: the customer clicked "Join Session" — link the booking
-- to the live guest_call and mark it completed so the auto-expire cron doesn't
-- later flag it as a no-show. Customer-only; only from the 'booked' state.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_booking_launched(_booking_id uuid, _guest_call_id uuid)
RETURNS public.engineer_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me    uuid := auth.uid();
  result public.engineer_bookings;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  UPDATE engineer_bookings
     SET guest_call_id = _guest_call_id, status = 'completed'
   WHERE id = _booking_id AND customer_user_id = _me AND status = 'booked'
   RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_LAUNCHABLE' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_booking_launched(uuid, uuid) TO authenticated;

COMMIT;
