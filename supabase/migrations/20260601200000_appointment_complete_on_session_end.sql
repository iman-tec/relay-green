-- ============================================================================
-- Free the appointment when its session ends
-- ============================================================================
-- An appointment's session (guest_calls, is_appointment) ending didn't update
-- the booking, so supervisor_bookings stayed 'booked' and the appointment kept
-- showing as live/in-progress on every surface (Appointments tab, /schedule,
-- the customer's sidebar) — all of which filter on status='booked'.
--
-- This stamps the booking 'completed' the moment its session goes terminal, so
-- it drops out of the active lists. Plus a one-time backfill for appointments
-- whose session already ended.
--
-- Additive: a trigger + function + backfill. Nothing dropped.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_appointment_on_session_end()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.supervisor_bookings
     SET status = 'completed'
   WHERE session_id = NEW.id
     AND status = 'booked';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_complete_appointment_on_session_end ON public.guest_calls;
CREATE TRIGGER trg_complete_appointment_on_session_end
  AFTER UPDATE OF status ON public.guest_calls
  FOR EACH ROW
  WHEN (
    NEW.is_appointment
    AND NEW.status IN ('ended', 'abandoned', 'cancelled')
    AND OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION public.complete_appointment_on_session_end();

-- Backfill: any appointment whose session has already ended.
UPDATE public.supervisor_bookings sb
   SET status = 'completed'
  FROM public.guest_calls g
 WHERE sb.session_id = g.id
   AND sb.status = 'booked'
   AND g.status IN ('ended', 'abandoned', 'cancelled');

COMMIT;
