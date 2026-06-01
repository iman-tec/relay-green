-- ============================================================================
-- Add engineer → assign them to the appointment session (they become host)
-- ============================================================================
-- Supervisors can't host a Zoom call (read-only monitors; the video token only
-- authorises claimed_by/customer). So the appointment call is hosted by the
-- engineer the supervisor adds: add_engineer_to_appointment now also assigns
-- that engineer to the booking's session (claimed_by + status='assigned'),
-- which makes them the host. When the engineer opens the session it auto-mints
-- Zoom and goes live; the customer's "Join" then lights up and the supervisor
-- monitors.
--
-- Replaces the RPC body only. Nothing dropped.
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
  _eng_pod  uuid;
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

  IF NOT EXISTS (
    SELECT 1 FROM guest_calls g
     WHERE g.project_id = result.project_id
       AND g.claimed_by = _engineer_user_id
       AND g.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'ENGINEER_NOT_ON_PROJECT' USING ERRCODE='P0001';
  END IF;

  SELECT full_name INTO _eng_name FROM profiles WHERE id = _engineer_user_id;
  SELECT pod_id INTO _eng_pod
    FROM pod_members
   WHERE user_id = _engineer_user_id AND pod_role = 'engineer'
   LIMIT 1;

  UPDATE supervisor_bookings
     SET engineer_invited_id   = _engineer_user_id,
         engineer_invited_at   = now(),
         engineer_invited_name = _eng_name
   WHERE id = _booking_id
   RETURNING * INTO result;

  -- Assign the engineer to the linked session so they become the host. When
  -- they open it, the assigned-engineer path auto-mints Zoom → goes live.
  IF result.session_id IS NOT NULL THEN
    UPDATE guest_calls
       SET claimed_by  = _engineer_user_id,
           status      = 'assigned',
           assigned_at = COALESCE(assigned_at, now()),
           claimed_at  = COALESCE(claimed_at, now()),
           pod_id      = COALESCE(pod_id, _eng_pod)
     WHERE id = result.session_id
       AND status NOT IN ('ended', 'abandoned', 'cancelled');
  END IF;

  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _engineer_user_id, result.quote_id, 'appointment_engineer_added',
    'Added to a supervisor appointment',
    'You were added to a call'
      || COALESCE(' about ' || result.project_name, '')
      || COALESCE(' with ' || result.customer_name, '') || ' — open it to start'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.add_engineer_to_appointment(uuid, uuid) TO authenticated;

COMMIT;
