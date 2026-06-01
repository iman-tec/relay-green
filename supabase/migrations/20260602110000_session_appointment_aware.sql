-- ============================================================================
-- get_or_create_active_customer_session: appointment-aware
-- ============================================================================
-- An appointment (supervisor_bookings) call only "worked" if the session the
-- customer + supervisor share is flagged is_appointment. But start_appointment_call
-- creates its own queued row, while the room resolves its session through THIS
-- function (and sometimes cancels + recreates it). Net effect: the session the
-- supervisor actually monitors was a plain session — is_appointment=false, no
-- supervisor_user_id, no booking link — so the supervisor stayed a read-only
-- monitor and couldn't add an engineer to the booking.
--
-- Fix: whenever this function resolves a session for a project that has a
-- STARTED, still-booked supervisor appointment for the caller, stamp that
-- session is_appointment=true + supervisor_user_id and point the booking's
-- session_id at it. This self-heals across the room's cancel/recreate, so the
-- live call is always a true appointment session.
--
-- Replaces the function body only; the create/entitlement path is unchanged.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_or_create_active_customer_session(_project_id uuid DEFAULT NULL)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _u             auth.users%ROWTYPE;
  _name          text;
  _email         text;
  _thread        uuid;
  _session       public.guest_calls;
  _ent           public.customer_entitlements;
  _proj_name     text;
  _is_employee   boolean := false;
  _emp_remaining numeric := 0;
  _bk            record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('relay-cust-session:' || auth.uid()::text, 0));

  -- Existing active session, if any.
  SELECT * INTO _session
    FROM guest_calls
    WHERE customer_user_id = auth.uid()
      AND status NOT IN ('ended','abandoned','cancelled')
    ORDER BY created_at DESC
    LIMIT 1;

  IF NOT FOUND THEN
    -- Entitlement gate before creating a NEW row. Employees route through the
    -- dept pool (profiles.remaining_minutes); everyone else uses the legacy
    -- customer_entitlements (free + paid).
    SELECT client_type = 'employee', COALESCE(remaining_minutes, 0)
      INTO _is_employee, _emp_remaining
      FROM profiles
     WHERE id = auth.uid();

    IF _is_employee THEN
      IF _emp_remaining <= 0 THEN
        RAISE EXCEPTION 'NO_ENTITLEMENT' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      SELECT * INTO _ent FROM customer_entitlements WHERE customer_user_id = auth.uid();
      IF FOUND THEN
        IF _ent.free_session_consumed_at IS NOT NULL AND _ent.paid_minutes_remaining <= 0 THEN
          RAISE EXCEPTION 'NO_ENTITLEMENT' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;

    SELECT * INTO _u FROM auth.users WHERE id = auth.uid();
    _email := _u.email;
    _name  := COALESCE(NULLIF(_u.raw_user_meta_data->>'full_name',''),
                       split_part(_u.email,'@',1));

    SELECT public.find_or_create_guest_thread(_email, NULL, _name) INTO _thread;

    IF NOT _is_employee THEN
      INSERT INTO customer_entitlements (customer_user_id) VALUES (auth.uid())
        ON CONFLICT DO NOTHING;
    END IF;

    IF _project_id IS NOT NULL THEN
      SELECT name INTO _proj_name
        FROM projects
        WHERE id = _project_id AND customer_id = auth.uid();
    END IF;

    INSERT INTO guest_calls (
      guest_name, guest_email, status, thread_id,
      customer_user_id, free_minutes,
      project_id, project_name
    ) VALUES (
      _name, _email, 'queued', _thread,
      auth.uid(), 10,
      CASE WHEN _proj_name IS NOT NULL THEN _project_id ELSE NULL END,
      _proj_name
    ) RETURNING * INTO _session;

    PERFORM _log_session_event(_session.id, 'session.created', NULL, 'queued', NULL);
  END IF;

  -- Appointment linkage. If this project has a STARTED, still-booked supervisor
  -- appointment for the caller, this session IS that appointment call — flag it
  -- so the owning supervisor can chat + add an engineer, and link the booking.
  IF _project_id IS NOT NULL THEN
    SELECT id, supervisor_user_id INTO _bk
      FROM supervisor_bookings
     WHERE customer_user_id = auth.uid()
       AND project_id = _project_id
       AND status = 'booked'
       AND call_started_at IS NOT NULL
       AND slot_end > now() - interval '2 hours'
     ORDER BY call_started_at DESC
     LIMIT 1;
    IF FOUND THEN
      IF _session.is_appointment IS DISTINCT FROM true
         OR _session.supervisor_user_id IS NULL THEN
        UPDATE guest_calls
           SET is_appointment      = true,
               supervisor_user_id  = COALESCE(supervisor_user_id, _bk.supervisor_user_id)
         WHERE id = _session.id
         RETURNING * INTO _session;
      END IF;
      UPDATE supervisor_bookings
         SET session_id = _session.id
       WHERE id = _bk.id AND session_id IS DISTINCT FROM _session.id;
    END IF;
  END IF;

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.get_or_create_active_customer_session(uuid) TO authenticated;

COMMIT;
