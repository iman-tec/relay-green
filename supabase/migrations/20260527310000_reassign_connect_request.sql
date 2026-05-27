-- ============================================================================
-- C4 — supervisor reroutes a pending callback to another engineer
-- ============================================================================
-- A customer's connect-request is waiting on an engineer who can't pick it up.
-- The supervisor reroutes it to a different engineer in the pod; the new
-- engineer sees it in their inbox, the clock resets.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reassign_connect_request(
  _id uuid, _new_engineer_user_id uuid
)
RETURNS public.engineer_connect_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.engineer_connect_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;
  -- Target must be an engineer in some pod (basic sanity).
  IF NOT EXISTS (SELECT 1 FROM pod_members WHERE user_id = _new_engineer_user_id AND pod_role = 'engineer') THEN
    RAISE EXCEPTION 'TARGET_NOT_ENGINEER' USING ERRCODE='P0001';
  END IF;

  UPDATE engineer_connect_requests
     SET engineer_user_id = _new_engineer_user_id,
         created_at = now(),
         expires_at = now() + interval '24 hours'
   WHERE id = _id AND status = 'pending'
   RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING' USING ERRCODE='P0001'; END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.reassign_connect_request(uuid, uuid) TO authenticated;

COMMIT;
