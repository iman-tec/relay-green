-- ============================================================================
-- book_supervisor_slot — support rescheduling (atomic replace)
-- ============================================================================
-- "Change appointment" books a new slot and must cancel the customer's existing
-- one so they never end up with two live bookings for the same bid. Adding an
-- optional _replace_id (defaulted, so the old 4-arg call still works): when set,
-- the caller's existing booking is cancelled inside the same transaction —
-- before the overlap check, so it frees that slot and can't linger as a
-- duplicate. Body is otherwise identical to the original RPC.
--
-- Drops the 4-arg signature and recreates a 5-arg one with a default, so the
-- single function (no overloading) serves both book + reschedule.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.book_supervisor_slot(uuid, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.book_supervisor_slot(
  _quote_id   uuid,
  _slot_start timestamptz,
  _slot_end   timestamptz,
  _notes      text,
  _replace_id uuid DEFAULT NULL
)
RETURNS public.supervisor_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me           uuid := auth.uid();
  _supervisor   uuid;
  _project_id   uuid;
  _project_name text;
  _customer_nm  text;
  _exists       int;
  result        public.supervisor_bookings;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _quote_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_QUOTE' USING ERRCODE='P0001';
  END IF;

  SELECT q.project_id, p.name
    INTO _project_id, _project_name
    FROM project_quote_requests q
    JOIN projects p ON p.id = q.project_id
   WHERE q.id = _quote_id
     AND q.customer_user_id = _me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_YOUR_QUOTE' USING ERRCODE='P0001';
  END IF;

  _supervisor := public.supervisor_for_quote(_quote_id);
  IF _supervisor IS NULL THEN
    RAISE EXCEPTION 'NO_SUPERVISOR_FOR_QUOTE' USING ERRCODE='P0001';
  END IF;

  IF _slot_end <= _slot_start THEN
    RAISE EXCEPTION 'INVALID_SLOT' USING ERRCODE='P0001';
  END IF;
  IF _slot_end - _slot_start <> interval '30 minutes' THEN
    RAISE EXCEPTION 'SLOT_NOT_30_MIN' USING ERRCODE='P0001';
  END IF;
  IF _slot_start < now() + interval '45 minutes' THEN
    RAISE EXCEPTION 'SLOT_TOO_SOON' USING ERRCODE='P0001';
  END IF;

  -- Reschedule: cancel the caller's existing booking first, so it neither
  -- blocks the overlap check nor lingers as a duplicate.
  IF _replace_id IS NOT NULL THEN
    UPDATE supervisor_bookings
       SET status = 'cancelled'
     WHERE id = _replace_id
       AND customer_user_id = _me
       AND status = 'booked';
  END IF;

  SELECT count(*) INTO _exists FROM supervisor_bookings
    WHERE supervisor_user_id = _supervisor
      AND status = 'booked'
      AND slot_start < _slot_end
      AND slot_end   > _slot_start;
  IF _exists > 0 THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(pr.full_name, cp.display_name)
    INTO _customer_nm
    FROM (SELECT _me AS uid) base
    LEFT JOIN profiles pr          ON pr.id = base.uid
    LEFT JOIN customer_profiles cp ON cp.user_id = base.uid;

  INSERT INTO supervisor_bookings (
    supervisor_user_id, customer_user_id, project_id, quote_id,
    slot_start, slot_end, customer_name, project_name, notes
  ) VALUES (
    _supervisor, _me, _project_id, _quote_id,
    _slot_start, _slot_end, _customer_nm, _project_name, _notes
  )
  RETURNING * INTO result;

  UPDATE project_quote_requests
     SET appointment_requested_at = now()
   WHERE id = _quote_id;

  INSERT INTO notifications (user_id, request_id, kind, title, body)
  VALUES (
    _supervisor, _quote_id, 'supervisor_appointment_booked',
    CASE WHEN _replace_id IS NOT NULL THEN 'Appointment rescheduled' ELSE 'New appointment booked' END,
    COALESCE(_customer_nm, 'A customer')
      || CASE WHEN _replace_id IS NOT NULL THEN ' moved their call' ELSE ' booked a call' END
      || COALESCE(' about ' || _project_name, '')
      || ' to ' || to_char(_slot_start, 'Mon DD, HH24:MI') || ' UTC'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.book_supervisor_slot(uuid, timestamptz, timestamptz, text, uuid) TO authenticated;

COMMIT;
