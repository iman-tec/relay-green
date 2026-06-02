-- ============================================================================
-- Pod holidays apply to SUPERVISORS too, not just engineers
-- ============================================================================
-- pod_set_holiday (and the membership-sync trigger) fanned a pod holiday out to
-- pod_role = 'engineer' only, so a pod's supervisor never got the day off on
-- their own calendar. Supervisors run appointments and share the same calendar
-- infra (engineer_holidays keyed by user id), so a pod-wide holiday must block
-- their calendar as well.
--
-- This is NOT a leave request — pod holidays live in engineer_holidays and show
-- up as a blocked date on the calendar; they never create a leave_requests row.
--
-- Changes:
--   • pod_set_holiday      → fan out to pod_role IN ('engineer','supervisor')
--   • sync trigger         → treat supervisors like engineers on join/leave/move
--   • one-time backfill     → give current pod supervisors their pod's future holidays
-- pod_edit_holiday / pod_remove_holiday / pod_list_holidays already operate on
-- every pod-tagged row regardless of role, so they need no change.
-- ============================================================================

BEGIN;

-- ── pod_set_holiday: include supervisors ─────────────────────────────────────
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
   WHERE pm.pod_id = _pod_id AND pm.pod_role IN ('engineer', 'supervisor')
  ON CONFLICT (engineer_user_id, holiday_date)
  DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, pod_id = EXCLUDED.pod_id;

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.pod_set_holiday(uuid, date, text, text) TO authenticated;

-- ── Membership sync: supervisors inherit / drop pod holidays too ─────────────
CREATE OR REPLACE FUNCTION public.sync_pod_holidays_on_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Inherit the pod's future holidays when someone is (or becomes) an engineer
  -- OR supervisor in it.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pod_role IN ('engineer', 'supervisor') THEN
    INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind, pod_id)
    SELECT NEW.user_id, h.holiday_date, h.label, h.kind, NEW.pod_id
      FROM (
        SELECT DISTINCT holiday_date, label, kind
          FROM engineer_holidays
         WHERE pod_id = NEW.pod_id AND holiday_date >= current_date
      ) h
    ON CONFLICT (engineer_user_id, holiday_date) DO NOTHING;
  END IF;

  -- Left the pod entirely → drop that pod's future holidays for them.
  IF TG_OP = 'DELETE' THEN
    DELETE FROM engineer_holidays
     WHERE engineer_user_id = OLD.user_id
       AND pod_id = OLD.pod_id
       AND holiday_date >= current_date;
    RETURN OLD;
  END IF;

  -- Role changed away from engineer/supervisor, or moved to a different pod →
  -- drop the OLD pod's future holidays for them.
  IF TG_OP = 'UPDATE'
     AND (
       (OLD.pod_role IN ('engineer', 'supervisor') AND NEW.pod_role NOT IN ('engineer', 'supervisor'))
       OR (NEW.pod_id <> OLD.pod_id)
     ) THEN
    DELETE FROM engineer_holidays
     WHERE engineer_user_id = OLD.user_id
       AND pod_id = OLD.pod_id
       AND holiday_date >= current_date;
  END IF;

  RETURN NEW;
END $fn$;

-- Trigger definition unchanged (AFTER INSERT/UPDATE/DELETE) — recreating the
-- function above is enough, but re-assert the trigger for idempotency.
DROP TRIGGER IF EXISTS trg_sync_pod_holidays ON public.pod_members;
CREATE TRIGGER trg_sync_pod_holidays
  AFTER INSERT OR UPDATE OR DELETE ON public.pod_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_pod_holidays_on_membership();

-- ── Backfill: give current pod supervisors their pod's future holidays ───────
INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind, pod_id)
SELECT pm.user_id, h.holiday_date, h.label, h.kind, h.pod_id
  FROM pod_members pm
  JOIN (
    SELECT DISTINCT pod_id, holiday_date, label, kind
      FROM engineer_holidays
     WHERE pod_id IS NOT NULL AND holiday_date >= current_date
  ) h ON h.pod_id = pm.pod_id
 WHERE pm.pod_role = 'supervisor'
ON CONFLICT (engineer_user_id, holiday_date) DO NOTHING;

COMMIT;
