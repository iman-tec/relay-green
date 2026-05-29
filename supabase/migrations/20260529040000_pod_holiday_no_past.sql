-- ============================================================================
-- Pod holidays cannot be set in the past
-- ============================================================================
-- Authoritative guard: pod_set_holiday refuses a past date, and
-- pod_edit_holiday refuses MOVING a holiday onto a past date (a same-date
-- label/kind edit of an already-passed holiday is still allowed). Uses
-- current_date (UTC) so "today" is always permitted regardless of caller tz.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pod_set_holiday(
  _pod_id uuid, _date date, _label text, _kind text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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
  IF _date IS NULL OR _date < current_date THEN
    RAISE EXCEPTION 'DATE_IN_PAST' USING ERRCODE='P0001';
  END IF;
  IF NOT (
    has_role(_me, 'super_admin') OR has_role(_me, 'admin')
    OR EXISTS (
      SELECT 1 FROM pod_members
      WHERE pod_id = _pod_id AND user_id = _me AND pod_role = 'supervisor'
    )
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind, pod_id)
  SELECT pm.user_id, _date, NULLIF(btrim(_label), ''), _kindv, _pod_id
    FROM pod_members pm
   WHERE pm.pod_id = _pod_id AND pm.pod_role = 'engineer'
  ON CONFLICT (engineer_user_id, holiday_date)
  DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, pod_id = EXCLUDED.pod_id;

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $fn$;

GRANT EXECUTE ON FUNCTION public.pod_set_holiday(uuid, date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pod_edit_holiday(
  _pod_id uuid, _old_date date, _new_date date, _label text, _kind text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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
  -- Can't move a holiday onto a past date. A same-date label/kind edit of an
  -- already-passed holiday is still allowed.
  IF _new_date IS NULL OR (_new_date <> _old_date AND _new_date < current_date) THEN
    RAISE EXCEPTION 'DATE_IN_PAST' USING ERRCODE='P0001';
  END IF;
  IF NOT (
    has_role(_me, 'super_admin') OR has_role(_me, 'admin')
    OR EXISTS (
      SELECT 1 FROM pod_members
      WHERE pod_id = _pod_id AND user_id = _me AND pod_role = 'supervisor'
    )
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind, pod_id)
  SELECT eh.engineer_user_id, _new_date, NULLIF(btrim(_label), ''), _kindv, _pod_id
    FROM engineer_holidays eh
   WHERE eh.pod_id = _pod_id AND eh.holiday_date = _old_date
  ON CONFLICT (engineer_user_id, holiday_date)
  DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, pod_id = EXCLUDED.pod_id;
  GET DIAGNOSTICS _count = ROW_COUNT;

  IF _new_date <> _old_date THEN
    DELETE FROM engineer_holidays
     WHERE pod_id = _pod_id AND holiday_date = _old_date;
  END IF;

  RETURN _count;
END $fn$;

GRANT EXECUTE ON FUNCTION public.pod_edit_holiday(uuid, date, date, text, text) TO authenticated;

COMMIT;
