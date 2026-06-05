-- ============================================================================
-- Relay — supervisor_for_quote: resolution fallbacks
-- ============================================================================
-- The original resolution chain (bid → project → projects.last_eng_connected
-- → that engineer's pod → the pod's supervisor) breaks whenever the project
-- has never had an engineer-connected session (last_eng_connected IS NULL —
-- e.g. the customer requested a quote before ever ringing anyone) or the
-- engineer isn't in a pod. The customer then saw "No supervisor is available
-- for this bid yet" — absurd from their side, since a supervisor literally
-- just SENT them the bid.
--
-- New resolution order (first match wins):
--   1. Pod supervisor of the project's last connected engineer (original).
--   2. Any pod supervisor who has PUBLISHED availability windows — so the
--      booking calendar the customer lands on actually has slots.
--   3. Any pod supervisor at all.
--   4. Any user holding the 'supervisor' role (covers supervisors not yet
--      assigned to a pod).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_for_quote(_quote_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT user_id FROM (
    -- 1. The pod supervisor of the project's last connected engineer.
    SELECT sup.user_id, 1 AS pri
      FROM project_quote_requests q
      JOIN projects p     ON p.id = q.project_id
      JOIN pod_members eng ON eng.user_id = p.last_eng_connected
                          AND eng.pod_role = 'engineer'
      JOIN pod_members sup ON sup.pod_id = eng.pod_id
                          AND sup.pod_role = 'supervisor'
     WHERE q.id = _quote_id

    UNION ALL

    -- 2. Any pod supervisor with published availability (calendar works).
    SELECT pm.user_id, 2 AS pri
      FROM pod_members pm
     WHERE pm.pod_role = 'supervisor'
       AND EXISTS (
         SELECT 1 FROM engineer_availability_windows w
          WHERE w.engineer_user_id = pm.user_id
       )

    UNION ALL

    -- 3. Any pod supervisor.
    SELECT pm.user_id, 3 AS pri
      FROM pod_members pm
     WHERE pm.pod_role = 'supervisor'

    UNION ALL

    -- 4. Any user holding the supervisor role (not yet in a pod).
    SELECT ur.user_id, 4 AS pri
      FROM user_role_names ur
     WHERE ur.role = 'supervisor'
  ) candidates
  ORDER BY pri
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.supervisor_for_quote(uuid) TO authenticated;

COMMIT;
