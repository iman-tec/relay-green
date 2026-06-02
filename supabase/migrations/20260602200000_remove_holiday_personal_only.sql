-- ============================================================================
-- remove_engineer_holiday only removes PERSONAL days off, never pod holidays
-- ============================================================================
-- Pod-wide holidays (engineer_holidays.pod_id IS NOT NULL) are set by the
-- Super-Admin for the whole pod. An engineer/supervisor must not be able to
-- delete their own copy — the UI hides the delete button for pod rows, and
-- this guards the RPC so a direct call can't bypass it. Personal days off
-- (pod_id IS NULL) remain freely removable by their owner.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.remove_engineer_holiday(_date date)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me   uuid := auth.uid();
  _del  int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  DELETE FROM engineer_holidays
   WHERE engineer_user_id = _me
     AND holiday_date = _date
     AND pod_id IS NULL;   -- never delete a pod-wide holiday
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN _del > 0;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_engineer_holiday(date) TO authenticated;

COMMIT;
