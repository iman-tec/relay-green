-- ============================================================================
-- Engineer notifications: call scheduled / rescheduled + leave decided
-- ============================================================================
-- Feeds the engineer dashboard notification bell. Reuses public.notifications
-- + create_notification(). Four notification kinds for the engineer/staff:
--   • call_scheduled    a new engineer_bookings row was booked for them
--   • call_rescheduled  an existing booked slot was moved
--   • leave_accepted    super-admin approved their leave request
--   • leave_rejected    super-admin / supervisor rejected their leave request
-- ============================================================================

BEGIN;

-- ── Booking notifications (scheduled + rescheduled) ──────────────────────────
CREATE OR REPLACE FUNCTION public.notify_engineer_on_booking()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _n     record;
  _when  text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'booked' THEN
      SELECT * INTO _n FROM public.booking_party_names(NEW);
      _when := to_char(NEW.slot_start, 'Mon DD, HH24:MI');
      PERFORM public.create_notification(
        NEW.engineer_user_id, NULL, 'call_scheduled',
        'New call scheduled',
        _n.customer_name || ' booked ' || _when || ' · ' || _n.project_name);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Slot moved while still booked → a reschedule.
    IF NEW.status = 'booked'
       AND (NEW.slot_start IS DISTINCT FROM OLD.slot_start
            OR NEW.slot_end IS DISTINCT FROM OLD.slot_end) THEN
      SELECT * INTO _n FROM public.booking_party_names(NEW);
      _when := to_char(NEW.slot_start, 'Mon DD, HH24:MI');
      PERFORM public.create_notification(
        NEW.engineer_user_id, NULL, 'call_rescheduled',
        'Call rescheduled',
        _n.customer_name || '''s call moved to ' || _when || ' · ' || _n.project_name);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_engineer_on_booking ON public.engineer_bookings;
CREATE TRIGGER trg_notify_engineer_on_booking
  AFTER INSERT OR UPDATE ON public.engineer_bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_engineer_on_booking();

-- ── Leave decision notifications (accepted / rejected) ───────────────────────
-- Same body as the prior version, with a create_notification call added to each
-- decision branch.
CREATE OR REPLACE FUNCTION public.decide_leave_request(
  _id uuid, _approve boolean, _reason text DEFAULT NULL
)
RETURNS public.leave_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  req     public.leave_requests;
  result  public.leave_requests;
  _is_admin boolean;
  _range  text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  SELECT * INTO req FROM leave_requests WHERE id = _id;
  IF req.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'ALREADY_DECIDED' USING ERRCODE='P0001'; END IF;

  _is_admin := has_role(_me, 'admin') OR has_role(_me, 'super_admin');

  IF _approve THEN
    IF NOT _is_admin THEN RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001'; END IF;

    UPDATE leave_requests
       SET status = 'approved', decided_by = _me, decided_at = now()
     WHERE id = _id AND status = 'pending'
     RETURNING * INTO result;

    -- Block the calendar: one engineer_holidays row per day in the range.
    INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind)
    SELECT result.requester_user_id, gs::date, NULLIF(btrim(result.reason), ''), result.kind
      FROM generate_series(result.start_date, result.end_date, interval '1 day') AS gs
    ON CONFLICT (engineer_user_id, holiday_date)
    DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind;

    _range := to_char(result.start_date, 'Mon DD')
              || CASE WHEN result.start_date = result.end_date THEN ''
                      ELSE ' → ' || to_char(result.end_date, 'Mon DD') END;
    PERFORM public.create_notification(
      result.requester_user_id, NULL, 'leave_accepted',
      'Leave request accepted',
      _range || ' (' || result.total_days || ' day'
        || CASE WHEN result.total_days = 1 THEN '' ELSE 's' END || ') was approved.');
  ELSE
    -- Reject: admin, or the pod supervisor of an ENGINEER's request.
    IF NOT (
      _is_admin
      OR (req.requester_role = 'engineer' AND EXISTS (
            SELECT 1 FROM pod_members pm
            WHERE pm.pod_id = req.pod_id AND pm.user_id = _me AND pm.pod_role = 'supervisor'
          ))
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
    END IF;

    -- A rejection must explain itself.
    IF NULLIF(btrim(_reason), '') IS NULL THEN
      RAISE EXCEPTION 'MISSING_REASON' USING ERRCODE='P0001';
    END IF;

    UPDATE leave_requests
       SET status = 'rejected', rejection_reason = NULLIF(btrim(_reason), ''),
           decided_by = _me, decided_at = now()
     WHERE id = _id AND status = 'pending'
     RETURNING * INTO result;

    _range := to_char(result.start_date, 'Mon DD')
              || CASE WHEN result.start_date = result.end_date THEN ''
                      ELSE ' → ' || to_char(result.end_date, 'Mon DD') END;
    PERFORM public.create_notification(
      result.requester_user_id, NULL, 'leave_rejected',
      'Leave request rejected',
      _range || ' was rejected. Reason: ' || result.rejection_reason);
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;

COMMIT;
