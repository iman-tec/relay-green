-- ============================================================================
-- Notify the pod supervisor when one of their engineers' leave is decided
-- ============================================================================
-- The requester is always notified (engineer or supervisor). This adds, for an
-- ENGINEER's request, a notification to that engineer's pod supervisor(s) too —
-- so supervisors see leave_accepted / leave_rejected outcomes for their pod in
-- the /supervise notification bell. A supervisor's OWN leave already notifies
-- them as the requester.
-- ============================================================================

BEGIN;

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
  _who    text;
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

    -- Inform the pod supervisor(s) about an engineer's decided leave.
    IF result.requester_role = 'engineer' THEN
      SELECT COALESCE(NULLIF(btrim(full_name), ''), 'An engineer')
        INTO _who FROM profiles WHERE id = result.requester_user_id;
      PERFORM public.notify_engineer_supervisors(
        result.requester_user_id, 'leave_accepted',
        'Engineer leave approved',
        _who || '''s leave (' || _range || ') was approved by an admin.');
    END IF;
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

    -- Inform the pod supervisor(s) about an engineer's decided leave. (A
    -- supervisor who did the rejecting will see it twice at worst — harmless.)
    IF result.requester_role = 'engineer' THEN
      SELECT COALESCE(NULLIF(btrim(full_name), ''), 'An engineer')
        INTO _who FROM profiles WHERE id = result.requester_user_id;
      PERFORM public.notify_engineer_supervisors(
        result.requester_user_id, 'leave_rejected',
        'Engineer leave rejected',
        _who || '''s leave (' || _range || ') was rejected. Reason: ' || result.rejection_reason);
    END IF;
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;

COMMIT;
