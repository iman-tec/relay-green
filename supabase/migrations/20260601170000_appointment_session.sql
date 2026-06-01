-- ============================================================================
-- Appointment call → a real (joinable) session in the SAME project
-- ============================================================================
-- When the customer starts the appointment call we now also create a guest_calls
-- session in the booking's project, flagged is_appointment. It's created with NO
-- intake, so the matcher (which is intake-driven: match_engineer(intake_id))
-- never auto-assigns an engineer. Being a queued/unclaimed call, it surfaces in
-- every pod supervisor's Waiting + All queue — there tagged "Appointment" — and
-- the customer can join it through the normal room flow. The supervisor picks it
-- up / adds an engineer manually.
--
-- Additive: a column on guest_calls, a link column on supervisor_bookings, and a
-- replaced RPC body. Nothing dropped.
-- ============================================================================

BEGIN;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS is_appointment boolean NOT NULL DEFAULT false;

ALTER TABLE public.supervisor_bookings
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.guest_calls(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.start_appointment_call(_booking_id uuid)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me         uuid := auth.uid();
  _email      text;
  _name       text;
  _thread     uuid;
  _session_id uuid;
  result      public.supervisor_bookings;
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

  IF now() < result.slot_start - interval '1 minute' THEN
    RAISE EXCEPTION 'TOO_EARLY' USING ERRCODE='P0001';
  END IF;

  IF result.call_started_at IS NULL THEN
    -- Customer identity for the session row.
    SELECT u.email,
           COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1))
      INTO _email, _name
      FROM auth.users u
     WHERE u.id = _me;

    SELECT public.find_or_create_guest_thread(_email, NULL, _name) INTO _thread;
    INSERT INTO customer_entitlements (customer_user_id) VALUES (_me)
      ON CONFLICT DO NOTHING;

    -- Queued, intake-less, appointment-flagged session in the SAME project.
    INSERT INTO guest_calls (
      guest_name, guest_email, status, thread_id, customer_user_id,
      project_id, project_name, supervisor_user_id, is_appointment
    ) VALUES (
      COALESCE(result.customer_name, _name), _email, 'queued', _thread, _me,
      result.project_id, result.project_name, result.supervisor_user_id, true
    )
    RETURNING id INTO _session_id;

    UPDATE supervisor_bookings
       SET call_started_at = now(),
           session_id      = _session_id
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
