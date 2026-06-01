-- ============================================================================
-- supervisor_busy_slots — expose a supervisor's booked intervals (times only)
-- ============================================================================
-- supervisor_bookings RLS only lets each party read their OWN bookings, so a
-- customer opening the scheduler can't see slots other customers have already
-- taken. This SECURITY DEFINER function returns just the busy start/end
-- intervals (no customer identity, no project) for a supervisor in a window, so
-- the picker can grey out / hide taken slots. It leaks only free/busy times for
-- a known supervisor — the same thing any shared booking link exposes.
--
-- Additive: a new function only. Nothing dropped.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_busy_slots(
  _supervisor_user_id uuid,
  _from               timestamptz,
  _to                 timestamptz
)
RETURNS TABLE (slot_start timestamptz, slot_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT slot_start, slot_end
    FROM supervisor_bookings
   WHERE supervisor_user_id = _supervisor_user_id
     AND status = 'booked'
     AND slot_start < _to
     AND slot_end   > _from
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_busy_slots(uuid, timestamptz, timestamptz) TO authenticated;

COMMIT;
