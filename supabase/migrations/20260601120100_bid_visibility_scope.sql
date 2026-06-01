-- ============================================================================
-- Bid visibility — scope to the assigned engineer + their supervisor
-- ============================================================================
-- Previously every staff member (engineer and above) could read every row in
-- project_quote_requests via the broad "Staff read quote requests" policy. With
-- supervisor scheduling, a bid belongs to a specific conversation: the engineer
-- who most recently connected to the project (projects.last_eng_connected) and
-- that engineer's pod supervisor. This narrows the SELECT policy to those two
-- parties.
--
-- Safety rails:
--   • super_admin keeps full visibility (cross-tenant ops backstop).
--   • If no engineer has connected to the project yet (last_eng_connected IS
--     NULL) there's nobody to scope to, so the row stays visible to staff
--     (engineer / supervisor / department_admin). This keeps intake & triage of
--     brand-new, unassigned bids working — they only narrow once an engineer
--     actually joins a session.
--
-- The customer's own-row policy ("Customer reads own quote requests") is
-- untouched. Writes go through SECURITY DEFINER RPCs (respond / appointment /
-- mark-viewed), which bypass RLS, so this SELECT change doesn't affect them.
--
-- Only a policy is swapped here (DROP POLICY / CREATE POLICY) — no table is
-- dropped. Reversible by restoring the old policy.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Staff read quote requests" ON public.project_quote_requests;

CREATE POLICY "Bid visible to assigned engineer and supervisor"
  ON public.project_quote_requests
  FOR SELECT TO authenticated
  USING (
    -- Cross-tenant ops backstop.
    has_role(auth.uid(), 'super_admin')

    -- The engineer last connected to this bid's project.
    OR EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = project_quote_requests.project_id
         AND p.last_eng_connected = auth.uid()
    )

    -- The supervisor of that engineer's pod.
    OR EXISTS (
      SELECT 1 FROM public.projects p
        JOIN public.pod_members eng ON eng.user_id = p.last_eng_connected
                                   AND eng.pod_role = 'engineer'
        JOIN public.pod_members sup ON sup.pod_id = eng.pod_id
                                   AND sup.pod_role = 'supervisor'
       WHERE p.id = project_quote_requests.project_id
         AND sup.user_id = auth.uid()
    )

    -- Unassigned fallback: no engineer has connected yet → keep staff-visible
    -- so intake/triage still surfaces the bid.
    OR (
      EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_quote_requests.project_id
           AND p.last_eng_connected IS NULL
      )
      AND (
        has_role(auth.uid(), 'engineer')
        OR has_role(auth.uid(), 'supervisor')
        OR has_role(auth.uid(), 'department_admin')
      )
    )
  );

COMMIT;
