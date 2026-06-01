-- ============================================================================
-- supervisor_bookings: capture a cancellation reason
-- ============================================================================
-- The customer-facing "Appointments" card now collects a reason when a booking
-- is cancelled. This adds the storage column + a reason-capturing RPC that
-- mirrors cancel_supervisor_booking but records the reason and surfaces it in
-- the notification to the other party. The original no-reason RPC is kept (the
-- client falls back to it if this migration hasn't been applied yet).
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.supervisor_bookings
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE OR REPLACE FUNCTION public.cancel_supervisor_booking_with_reason(
  _id     uuid,
  _reason text DEFAULT NULL
)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _other  uuid;
  _clean  text := NULLIF(btrim(_reason), '');
  result  public.supervisor_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM supervisor_bookings
    WHERE id = _id
      AND (supervisor_user_id = _me OR customer_user_id = _me)
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF result.status <> 'booked' THEN
    RETURN result;
  END IF;

  UPDATE supervisor_bookings
     SET status = 'cancelled', cancel_reason = _clean
   WHERE id = _id
   RETURNING * INTO result;

  _other := CASE WHEN _me = result.supervisor_user_id
                 THEN result.customer_user_id ELSE result.supervisor_user_id END;
  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _other, result.quote_id, 'supervisor_appointment_cancelled',
    'Appointment cancelled',
    'The ' || to_char(result.slot_start, 'Mon DD, HH24:MI') || ' UTC call was cancelled'
      || COALESCE(' · ' || _clean, '')
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_supervisor_booking_with_reason(uuid, text) TO authenticated;

COMMIT;
