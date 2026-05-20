-- ============================================================================
-- can_access_chat_session: fix stale user_roles.role reference
-- ============================================================================
-- Same class of bug as 20260521150000_match_engineer_role_id_fix.sql.
--
-- can_access_chat_session (defined 2026-05-14) joined user_roles directly:
--     SELECT 1 FROM public.user_roles ur
--      WHERE ur.user_id = _user_id
--        AND ur.role IN ('pod_lead', 'ops_manager', 'admin',
--                        'enterprise_admin', 'super_admin')
--
-- The 2026-05-20 role refactor (20260521120000_roles_lookup_fk.sql) dropped
-- the user_roles.role text column. The function body wasn't re-validated by
-- Postgres on the schema change, so it now fails at runtime: supervisor-tier
-- users (the gate's whole point) can no longer view chat attachments on
-- sessions they don't own.
--
-- Fix: swap the inline user_roles join for the has_role() shim, which
-- aliases legacy role names (admin → enterprise_admin, pod_lead → supervisor,
-- ops_manager → department_admin) onto the new lookup. Function semantics
-- unchanged.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_chat_session(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = _session_id
      AND (gc.customer_user_id = _user_id OR gc.claimed_by = _user_id)
  )
  OR public.has_role(_user_id, 'pod_lead')
  OR public.has_role(_user_id, 'ops_manager')
  OR public.has_role(_user_id, 'admin')
  OR public.has_role(_user_id, 'enterprise_admin')
  OR public.has_role(_user_id, 'super_admin');
$$;

GRANT EXECUTE ON FUNCTION public.can_access_chat_session(uuid, uuid) TO authenticated;

COMMIT;
