-- ============================================================================
-- Leave requests — self-submitted leave with an approval gate
-- ============================================================================
-- Replaces the old self-service "block dates directly" tool on the engineer /
-- supervisor calendar. Now a staff member fills a Request Form (from → to +
-- reason); nothing is blocked on their calendar until a SUPER-ADMIN approves.
--
-- Authority model:
--   • Engineers and supervisors SUBMIT their own leave (submit_leave_request).
--   • SUPER-ADMIN approves or rejects (Bench → Requests).
--   • A pod SUPERVISOR may also REJECT (never approve) a pending request from
--     an ENGINEER in their own pod — they monitor, super-admin owns sign-off.
--   • On APPROVE the date range is written into engineer_holidays (the calendar
--     block). On REJECT nothing is blocked; the requester sees it in red and
--     can delete it.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'engineer' | 'supervisor' — drives who may reject + the approver shown.
  requester_role    text NOT NULL CHECK (requester_role IN ('engineer', 'supervisor')),
  pod_id            uuid REFERENCES public.pods(id) ON DELETE SET NULL,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  total_days        int  NOT NULL,
  reason            text NOT NULL,
  -- Maps onto engineer_holidays.kind when approved.
  kind              text NOT NULL DEFAULT 'vacation'
                    CHECK (kind IN ('holiday', 'vacation', 'sick', 'personal', 'other')),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_requester ON public.leave_requests (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_pending   ON public.leave_requests (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_leave_requests_pod       ON public.leave_requests (pod_id, status);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Requester reads their own requests.
DROP POLICY IF EXISTS "Requester reads own leave" ON public.leave_requests;
CREATE POLICY "Requester reads own leave" ON public.leave_requests
  FOR SELECT TO authenticated USING (requester_user_id = auth.uid());

-- A pod supervisor reads requests belonging to their pod (to reject engineers').
DROP POLICY IF EXISTS "Pod supervisor reads pod leave" ON public.leave_requests;
CREATE POLICY "Pod supervisor reads pod leave" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pod_members pm
    WHERE pm.pod_id = leave_requests.pod_id
      AND pm.user_id = auth.uid()
      AND pm.pod_role = 'supervisor'
  ));

-- Admin / super-admin read everything.
DROP POLICY IF EXISTS "Admins read all leave" ON public.leave_requests;
CREATE POLICY "Admins read all leave" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'));

-- All writes go through SECURITY DEFINER RPCs below (no direct write policies).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leave_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
  END IF;
END $$;

-- ── RPC: submit_leave_request (engineer / supervisor submits own leave) ──────
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  _start date, _end date, _reason text, _kind text DEFAULT 'vacation'
)
RETURNS public.leave_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _role   text;
  _pod    uuid;
  _kindv  text := COALESCE(NULLIF(btrim(_kind), ''), 'vacation');
  _reasonv text := NULLIF(btrim(_reason), '');
  result  public.leave_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  IF has_role(_me, 'engineer') THEN
    _role := 'engineer';
  ELSIF has_role(_me, 'supervisor') THEN
    _role := 'supervisor';
  ELSE
    RAISE EXCEPTION 'NOT_STAFF' USING ERRCODE='P0001';
  END IF;

  IF _kindv NOT IN ('holiday', 'vacation', 'sick', 'personal', 'other') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE='P0001';
  END IF;
  IF _start IS NULL OR _end IS NULL THEN
    RAISE EXCEPTION 'MISSING_DATE' USING ERRCODE='P0001';
  END IF;
  IF _end < _start THEN
    RAISE EXCEPTION 'END_BEFORE_START' USING ERRCODE='P0001';
  END IF;
  IF _start < current_date THEN
    RAISE EXCEPTION 'DATE_IN_PAST' USING ERRCODE='P0001';
  END IF;
  IF _reasonv IS NULL THEN
    RAISE EXCEPTION 'MISSING_REASON' USING ERRCODE='P0001';
  END IF;

  SELECT pod_id INTO _pod
    FROM pod_members
   WHERE user_id = _me AND pod_role = _role
   LIMIT 1;

  INSERT INTO leave_requests (
    requester_user_id, requester_role, pod_id, start_date, end_date, total_days, reason, kind
  )
  VALUES (
    _me, _role, _pod, _start, _end, (_end - _start) + 1, _reasonv, _kindv
  )
  RETURNING * INTO result;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_leave_request(date, date, text, text) TO authenticated;

-- ── RPC: decide_leave_request (approve / reject a pending request) ───────────
-- _approve = true  → super-admin only; writes the date range into
--                    engineer_holidays (the actual calendar block).
-- _approve = false → super-admin, OR the pod supervisor of an engineer's
--                    request; stores the rejection reason.
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

    UPDATE leave_requests
       SET status = 'rejected', rejection_reason = NULLIF(btrim(_reason), ''),
           decided_by = _me, decided_at = now()
     WHERE id = _id AND status = 'pending'
     RETURNING * INTO result;
  END IF;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.decide_leave_request(uuid, boolean, text) TO authenticated;

-- ── RPC: delete_leave_request (requester clears their own pending/rejected) ──
-- Approved requests are not deletable here — their calendar block is managed
-- through the holiday list (remove_engineer_holiday).
CREATE OR REPLACE FUNCTION public.delete_leave_request(_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me  uuid := auth.uid();
  _del int;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;

  DELETE FROM leave_requests
   WHERE id = _id
     AND requester_user_id = _me
     AND status IN ('pending', 'rejected');
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_leave_request(uuid) TO authenticated;

COMMIT;
