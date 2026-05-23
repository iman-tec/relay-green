-- ============================================================================
-- Supervisors can (re)assign to ANY engineer, not just their own pod
-- ============================================================================
-- _can_manually_assign previously let supervisors/pod_leads assign only
-- engineers within the pod they run. Per product feedback, when reassigning a
-- declined session (or assigning in general) a supervisor — like a super_admin
-- — must be able to pick ANY engineer on the platform. The target is still
-- validated as an actual engineer in supervisor_assign_engineer.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._can_manually_assign(_caller uuid, _engineer uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Any supervisor-tier role may manually assign any engineer. (The engineer
  -- target itself is role-checked by the caller.)
  RETURN
    has_role(_caller, 'super_admin')
    OR has_role(_caller, 'admin')
    OR has_role(_caller, 'ops_manager')
    OR has_role(_caller, 'supervisor')
    OR has_role(_caller, 'pod_lead');
END $$;

GRANT EXECUTE ON FUNCTION public._can_manually_assign(uuid, uuid) TO authenticated;

COMMIT;
