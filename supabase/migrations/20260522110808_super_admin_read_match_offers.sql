-- Live matching board visibility on /supervise.
--
-- The existing engineer/customer policies on engineer_match_offers are
-- narrow by design (each user sees only their own rows). Supervisors and
-- super_admins need to observe the live ring buffer so they can spot
-- stuck queues, decline storms, and bad scoring in real time. RLS gates
-- realtime postgres_changes as well as direct queries, so both audiences
-- need their own SELECT policy here.
--
-- Two policies, OR-merged by RLS at evaluation time:
--   * Supervisors see offers being made to engineers in *their pod only*.
--   * Super_admins see every offer (used by the future global matching
--     dashboard; today's UI surfaces the pod-scoped supervisor view).

DROP POLICY IF EXISTS "Super admin reads all offers" ON public.engineer_match_offers;
CREATE POLICY "Super admin reads all offers" ON public.engineer_match_offers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Supervisor reads pod offers" ON public.engineer_match_offers;
CREATE POLICY "Supervisor reads pod offers" ON public.engineer_match_offers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.pod_members sup
        JOIN public.pod_members eng ON eng.pod_id = sup.pod_id
       WHERE sup.user_id  = auth.uid()
         AND sup.pod_role = 'supervisor'
         AND eng.user_id  = engineer_match_offers.engineer_user_id
         AND eng.pod_role = 'engineer'
    )
  );
