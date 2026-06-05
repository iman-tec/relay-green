-- ============================================================================
-- Relay — bookings: stamp cancelled_at for the customer notification feed
-- ============================================================================
-- The customer NotificationBell derives its feed from data (no notification
-- table). "Booked" events timestamp off created_at, but CANCELLED events had
-- no timestamp at all — engineer_bookings / supervisor_bookings only carry
-- created_at, so a cancellation couldn't surface as a fresh notification.
--
-- Adds cancelled_at to both tables + a shared BEFORE UPDATE trigger that
-- stamps it on any booked→cancelled transition, regardless of which RPC or
-- path performs the cancel (cancel_booking_with_reason,
-- cancel_supervisor_booking[_with_reason], manual updates).
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.supervisor_bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_booking_cancelled_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS eb_stamp_cancelled ON public.engineer_bookings;
CREATE TRIGGER eb_stamp_cancelled
  BEFORE UPDATE ON public.engineer_bookings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_booking_cancelled_at();

DROP TRIGGER IF EXISTS sb_stamp_cancelled ON public.supervisor_bookings;
CREATE TRIGGER sb_stamp_cancelled
  BEFORE UPDATE ON public.supervisor_bookings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_booking_cancelled_at();

COMMIT;
