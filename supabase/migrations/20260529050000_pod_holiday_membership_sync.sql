-- ============================================================================
-- Keep pod holidays consistent with pod membership
-- ============================================================================
-- pod_set_holiday only fans a date out to engineers who are in the pod AT
-- THAT MOMENT. Anyone who joins the pod later never gets the row, so their
-- calendar/scheduler (which reads engineer_holidays directly) misses the
-- day off.
--
-- A trigger on pod_members keeps it consistent no matter how membership
-- changes (admin UI, RPC, seed):
--   * join as engineer / become engineer / move into a pod
--       → inherit that pod's FUTURE holidays (ON CONFLICT DO NOTHING so a
--         personal day off already on that date is preserved).
--   * leave the pod / stop being an engineer / move to another pod
--       → drop that pod's FUTURE holidays for them (pod-tagged rows only;
--         personal days off, pod_id IS NULL, are never touched).
--
-- A one-time backfill repairs engineers who already joined after a holiday
-- was declared.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_pod_holidays_on_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Inherit the pod's future holidays when someone is (or becomes) an engineer in it.
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pod_role = 'engineer' THEN
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

  -- Role changed away from engineer, or moved to a different pod → drop the
  -- OLD pod's future holidays for them.
  IF TG_OP = 'UPDATE'
     AND (
       (OLD.pod_role = 'engineer' AND NEW.pod_role <> 'engineer')
       OR (NEW.pod_id <> OLD.pod_id)
     ) THEN
    DELETE FROM engineer_holidays
     WHERE engineer_user_id = OLD.user_id
       AND pod_id = OLD.pod_id
       AND holiday_date >= current_date;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_sync_pod_holidays ON public.pod_members;
CREATE TRIGGER trg_sync_pod_holidays
  AFTER INSERT OR UPDATE OR DELETE ON public.pod_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_pod_holidays_on_membership();

-- One-time backfill: give every current pod engineer their pod's future
-- holidays they don't already have.
INSERT INTO engineer_holidays (engineer_user_id, holiday_date, label, kind, pod_id)
SELECT pm.user_id, h.holiday_date, h.label, h.kind, h.pod_id
  FROM pod_members pm
  JOIN (
    SELECT DISTINCT pod_id, holiday_date, label, kind
      FROM engineer_holidays
     WHERE pod_id IS NOT NULL AND holiday_date >= current_date
  ) h ON h.pod_id = pm.pod_id
 WHERE pm.pod_role = 'engineer'
ON CONFLICT (engineer_user_id, holiday_date) DO NOTHING;

COMMIT;
