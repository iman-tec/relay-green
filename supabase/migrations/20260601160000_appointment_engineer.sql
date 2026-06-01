-- ============================================================================
-- Appointment — supervisor adds an engineer who worked on the project
-- ============================================================================
-- Once the customer has started the appointment call, the supervisor can pull
-- in an engineer who has worked on that project. engineers_for_project() powers
-- the picker (distinct engineers who claimed a non-cancelled session on the
-- project); add_engineer_to_appointment() records the choice + notifies the
-- engineer. Supervisor-only; the engineer must actually have worked the project.
--
-- Additive: new columns + functions. Nothing dropped.
-- ============================================================================

BEGIN;

ALTER TABLE public.supervisor_bookings
  ADD COLUMN IF NOT EXISTS engineer_invited_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS engineer_invited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS engineer_invited_name text;

-- Engineers who have worked on a project (claimed a non-cancelled session),
-- most-recent first. SECURITY DEFINER so the supervisor can resolve across the
-- project's sessions + profiles.
CREATE OR REPLACE FUNCTION public.engineers_for_project(_project_id uuid)
RETURNS TABLE (engineer_user_id uuid, full_name text, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT g.claimed_by AS engineer_user_id,
         pr.full_name,
         max(g.created_at) AS last_at
    FROM guest_calls g
    LEFT JOIN profiles pr ON pr.id = g.claimed_by
   WHERE g.project_id = _project_id
     AND g.claimed_by IS NOT NULL
     AND g.status <> 'cancelled'
   GROUP BY g.claimed_by, pr.full_name
   ORDER BY max(g.created_at) DESC
$$;

GRANT EXECUTE ON FUNCTION public.engineers_for_project(uuid) TO authenticated;

-- Supervisor adds an engineer to a (started) appointment.
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

  -- The engineer must actually have worked on the project.
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

  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _engineer_user_id, result.quote_id, 'appointment_engineer_added',
    'Added to a supervisor appointment',
    'You were added to a call'
      || COALESCE(' about ' || result.project_name, '')
      || COALESCE(' with ' || result.customer_name, '') || ' — join now'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.add_engineer_to_appointment(uuid, uuid) TO authenticated;

COMMIT;
