DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;

CREATE POLICY "Users view own and related profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR has_role(auth.uid(), 'pod_lead')
  OR has_role(auth.uid(), 'ops_manager')
  OR has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.requests r
    WHERE (r.builder_id = auth.uid() AND r.assigned_engineer_id = profiles.id)
       OR (r.assigned_engineer_id = auth.uid() AND r.builder_id = profiles.id)
  )
  OR EXISTS (
    SELECT 1 FROM public.request_messages m
    WHERE m.sender_id = profiles.id
      AND can_view_request(m.request_id, auth.uid())
  )
);