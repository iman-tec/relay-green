-- ============================================================================
-- A leave rejection must carry a reason
-- ============================================================================
-- The UI now requires a rejection reason (super-admin inbox + supervisor team
-- leave calendar). This adds the authoritative backend guard so a reject can't
-- slip through reasonless via a direct RPC call. Approve is unaffected.
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
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;

COMMIT;
