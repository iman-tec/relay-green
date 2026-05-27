-- ============================================================================
-- Bulk pod-holiday set (B4) — mark a whole pod off on a date
-- ============================================================================
-- A super-admin (or the pod's own supervisor) blocks a date across every
-- engineer in a pod in one shot — e.g. a public holiday. Writes one
-- engineer_holidays row per pod engineer (idempotent on the PK).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pod_set_holiday(
  _pod_id uuid,
  _date   date,
  _label  text,
  _kind   text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  _kindv  text := COALESCE(NULLIF(btrim(_kind), ''), 'holiday');
  _count  int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _kindv NOT IN ('holiday', 'vacation', 'sick', 'personal', 'other') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE='P0001';
  END IF;
  -- super_admin, or the supervisor of this pod.
  IF NOT (
    has_role(_me, 'super_admin') OR has_role(_me, 'admin')
    OR EXISTS (
      SELECT 1 FROM pod_members
      WHERE pod_id = _pod_id AND user_id = _me AND pod_role = 'supervisor'
    )
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind)
  SELECT pm.user_id, _date, NULLIF(btrim(_label), ''), _kindv
    FROM pod_members pm
   WHERE pm.pod_id = _pod_id AND pm.pod_role = 'engineer'
  ON CONFLICT (engineer_user_id, holiday_date)
  DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind;

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.pod_set_holiday(uuid, date, text, text) TO authenticated;

COMMIT;
