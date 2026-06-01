-- ============================================================================
-- Appointment call start — customer kicks off the scheduled call
-- ============================================================================
-- At (or after) the scheduled time the customer clicks "Start appointment call".
-- That stamps call_started_at on the booking and notifies ONLY the supervisor
-- who owns the appointment (engineers are deliberately not told — this is a
-- supervisor↔customer call). The supervisor sees it via their notification bell
-- and the /schedule "live" badge.
--
-- Additive: a new column + RPC. Nothing dropped.
-- ============================================================================

BEGIN;

ALTER TABLE public.supervisor_bookings
  ADD COLUMN IF NOT EXISTS call_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.start_appointment_call(_booking_id uuid)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me    uuid := auth.uid();
  result public.supervisor_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO result FROM supervisor_bookings
   WHERE id = _booking_id
     AND customer_user_id = _me
     AND status = 'booked'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  -- Only once the scheduled time has effectively arrived (1-min tolerance).
  IF now() < result.slot_start - interval '1 minute' THEN
    RAISE EXCEPTION 'TOO_EARLY' USING ERRCODE='P0001';
  END IF;

  -- Idempotent: first start stamps + notifies the supervisor.
  IF result.call_started_at IS NULL THEN
    UPDATE supervisor_bookings
       SET call_started_at = now()
     WHERE id = _booking_id
     RETURNING * INTO result;

    INSERT INTO notifications (user_id, request_id, kind, title, body)
    VALUES (
      result.supervisor_user_id, result.quote_id, 'appointment_call_started',
      'Customer started the appointment call',
      COALESCE(result.customer_name, 'A customer') || ' is ready'
        || COALESCE(' for ' || result.project_name, '') || ' — join the call now'
    );
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.start_appointment_call(uuid) TO authenticated;

COMMIT;
