-- ============================================================================
-- Pod-holiday review / edit / delete (admin)
-- ============================================================================
-- pod_set_holiday fans a date out into one engineer_holidays row per pod
-- engineer, but those rows were indistinguishable from an engineer's own
-- vacation — so the admin could set a pod holiday and then had no way to
-- review, correct, or remove it.
--
-- We tag pod-originated rows with pod_id, stamp it in pod_set_holiday, and
-- add list / edit / remove RPCs scoped to that pod_id. Individual engineer
-- days-off (pod_id NULL) are never touched by the pod-level operations.
-- ============================================================================

BEGIN;

-- ── Tag column ─────────────────────────────────────────────────────────────
ALTER TABLE public.engineer_holidays
  ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES public.pods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_engineer_holidays_pod
  ON public.engineer_holidays (pod_id, holiday_date) WHERE pod_id IS NOT NULL;

-- ── pod_set_holiday: now stamps pod_id ───────────────────────────────────────
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
END $$;

GRANT EXECUTE ON FUNCTION public.pod_set_holiday(uuid, date, text, text) TO authenticated;

-- ── Shared auth guard (inline in each RPC to keep them self-contained) ───────
-- super_admin / admin / the pod's supervisor.

-- ── pod_list_holidays: one logical holiday per (date, label, kind) ───────────
CREATE OR REPLACE FUNCTION public.pod_list_holidays(_pod_id uuid)
RETURNS TABLE (holiday_date date, label text, kind text, engineer_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
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

  RETURN QUERY
    SELECT eh.holiday_date, eh.label, eh.kind, COUNT(*)::int AS engineer_count
      FROM engineer_holidays eh
     WHERE eh.pod_id = _pod_id
     GROUP BY eh.holiday_date, eh.label, eh.kind
     ORDER BY eh.holiday_date;
END $$;

GRANT EXECUTE ON FUNCTION public.pod_list_holidays(uuid) TO authenticated;

-- ── pod_edit_holiday: move date and/or change label/kind ─────────────────────
-- Pod-wins-on-conflict, consistent with pod_set_holiday's upsert: if moving
-- onto a date an affected engineer already has, the pod entry overwrites it.
CREATE OR REPLACE FUNCTION public.pod_edit_holiday(
  _pod_id   uuid,
  _old_date date,
  _new_date date,
  _label    text,
  _kind     text
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
  IF NOT (
    has_role(_me, 'super_admin') OR has_role(_me, 'admin')
    OR EXISTS (
      SELECT 1 FROM pod_members
      WHERE pod_id = _pod_id AND user_id = _me AND pod_role = 'supervisor'
    )
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  -- Re-home the affected engineers' rows onto the new date (upsert), then
  -- drop the old-date rows when the date actually changed.
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
END $$;

GRANT EXECUTE ON FUNCTION public.pod_edit_holiday(uuid, date, date, text, text) TO authenticated;

-- ── pod_remove_holiday: unblock the pod on a date ────────────────────────────
CREATE OR REPLACE FUNCTION public.pod_remove_holiday(_pod_id uuid, _date date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me    uuid := auth.uid();
  _count int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
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

  DELETE FROM engineer_holidays
   WHERE pod_id = _pod_id AND holiday_date = _date;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.pod_remove_holiday(uuid, date) TO authenticated;

COMMIT;
