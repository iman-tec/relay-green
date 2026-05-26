-- ============================================================================
--  supervisor_set_engineer_online — let supervisors flip any engineer on/offline
-- ============================================================================
--  Mirrors engineer_set_online (20260522150000) but targets a specific
--  engineer and is gated to supervisor-class roles instead of self. Updates
--  engineer_profiles.is_available (the flag the matcher rings on), writes the
--  engineer_status_changes audit row, and opens/closes the engineer_sessions
--  stint — exactly like the engineer's own toggle, so presence stays coherent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_set_engineer_online(
  _engineer_id uuid,
  _online      boolean
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me      uuid := auth.uid();
  _updated int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Supervisor-class roles only.
  IF NOT (
       has_role(_me, 'supervisor')
    OR has_role(_me, 'pod_lead')
    OR has_role(_me, 'ops_manager')
    OR has_role(_me, 'admin')
    OR has_role(_me, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_role(_engineer_id, 'engineer') THEN
    RAISE EXCEPTION 'TARGET_NOT_ENGINEER' USING ERRCODE = 'P0001';
  END IF;

  UPDATE engineer_profiles
     SET is_available = _online, updated_at = now()
   WHERE user_id = _engineer_id;
  GET DIAGNOSTICS _updated = ROW_COUNT;
  IF _updated = 0 THEN
    RAISE EXCEPTION 'NO_ENGINEER_PROFILE' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO engineer_status_changes (engineer_id, is_online)
  VALUES (_engineer_id, _online);

  IF _online THEN
    INSERT INTO engineer_sessions (engineer_id, status)
    VALUES (_engineer_id, 'active')
    ON CONFLICT (engineer_id) WHERE status = 'active' DO NOTHING;
  ELSE
    UPDATE engineer_sessions
       SET logout_time = now(), status = 'logged_out'
     WHERE engineer_id = _engineer_id AND status = 'active';
  END IF;

  RETURN _online;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_set_engineer_online(uuid, boolean) TO authenticated;

COMMIT;
