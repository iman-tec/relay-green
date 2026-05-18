-- ============================================================================
-- Fix: infinite recursion in pod_members_same_pod_read (42P17)
-- ============================================================================
-- The original policy from 20260514120000_pods_staff_management.sql reads
-- pod_members from inside an RLS policy ON pod_members:
--
--   USING (pod_id IN (SELECT pod_id FROM pod_members WHERE user_id = auth.uid()))
--
-- Postgres treats that as recursive and aborts the query with 42P17. The
-- bug only surfaces when an authenticated user actually SELECTs from
-- pod_members — bug #7's supervise pod-scope lookup is the first caller in
-- the live UI path that does this, which is why it's only blowing up now.
--
-- Fix: wrap the inner lookup in a SECURITY DEFINER function. The function
-- bypasses RLS, so the policy expression no longer recurses into itself.
-- Semantics are preserved: pod_members.user_id is UNIQUE, so a viewer
-- belongs to at most one pod and the IN-clause collapses to equality.
-- ============================================================================

BEGIN;

-- ── 1. Helper: resolve a user's pod, bypassing pod_members RLS ─────────────
CREATE OR REPLACE FUNCTION public.user_pod_id(_uid uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT pod_id FROM public.pod_members WHERE user_id = _uid LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.user_pod_id(uuid) TO authenticated;

-- ── 2. Replace the recursive SELECT policy ─────────────────────────────────
DROP POLICY IF EXISTS pod_members_same_pod_read ON public.pod_members;

CREATE POLICY pod_members_same_pod_read ON public.pod_members
  FOR SELECT TO authenticated
  USING (pod_id = public.user_pod_id(auth.uid()));

COMMIT;
