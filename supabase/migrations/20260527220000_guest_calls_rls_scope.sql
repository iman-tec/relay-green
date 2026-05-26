-- ============================================================================
-- Tighten guest_calls SELECT — close the world-readable hole (GDPR).
-- ============================================================================
-- BEFORE: "Public read guest_calls" USING (true) — every session row
-- (guest_name, guest_email, customer_user_id, durations, AI summary titles)
-- was readable by ANY authenticated user and ANY anon. That was originally
-- required because anonymous /room visitors had no auth.uid() to scope by.
--
-- That premise no longer holds: the Try-RELAY guest funnel now mints a real
-- Supabase ANONYMOUS session, so every /room visitor has an auth.uid() and
-- their own sessions carry customer_user_id = auth.uid(). We can therefore
-- scope reads to the people with a relationship to the session.
--
-- Who must still read guest_calls (consumer-by-consumer):
--   • Customer (incl. anon guest)  → customer_user_id = auth.uid()
--   • Engineer on the call         → claimed_by = auth.uid()
--   • Assigned supervisor          → supervisor_user_id = auth.uid()
--   • Engineers (queue to claim)   → role 'engineer'  (staff, not third party)
--   • Supervisors (pod monitoring) → role 'supervisor' (UI filters by pod_id)
--   • Super admin                  → role 'super_admin'
--   • Enterprise/Dept admin        → session's organization_id = their org
-- Queue + recent + matching for engineers also go through SECURITY DEFINER
-- RPCs (list_queue, engineer_recent_sessions, match_engineer) which bypass
-- RLS regardless; the role grants above cover the remaining direct selects.
--
-- Recursion note: org scoping reads profiles. To avoid the self-referential
-- recursion that forced the org-scoped *profiles* policies to be dropped
-- (20260514140000), we resolve the caller's org via a SECURITY DEFINER helper
-- that bypasses RLS.
--
-- ⚠️ HIGH BLAST RADIUS — guest_calls is the most-read table in the app. Apply
-- to staging and walk the test checklist (customer room load, intake/matching,
-- engineer inbox/queue/claim, supervise board, enterprise dashboards) BEFORE
-- production. Roll back by recreating "Public read guest_calls" USING(true).
-- ============================================================================

BEGIN;

-- Caller's organization_id, resolved without triggering profiles RLS.
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated, anon;

DROP POLICY IF EXISTS "Public read guest_calls" ON public.guest_calls;

CREATE POLICY "Scoped read guest_calls"
ON public.guest_calls FOR SELECT
TO authenticated
USING (
  customer_user_id = auth.uid()
  OR claimed_by = auth.uid()
  OR supervisor_user_id = auth.uid()
  OR has_role(auth.uid(), 'engineer')
  OR has_role(auth.uid(), 'supervisor')
  OR has_role(auth.uid(), 'super_admin')
  OR (
    organization_id IS NOT NULL
    AND organization_id = public.current_user_org_id()
    AND (
      has_role(auth.uid(), 'enterprise_admin')
      OR has_role(auth.uid(), 'department_admin')
    )
  )
);

COMMIT;
