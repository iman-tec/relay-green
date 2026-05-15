-- Add user/project columns to call_recordings so the supervisor view can
-- filter recordings + AI summaries by builder, engineer, and project without
-- depending on chat-message side-effects.
--
-- Path B (logged-in request flow) populates these from call_sessions on
-- upsert. project_id stays NULL today because `requests` has no project link;
-- the column is in place so a future requests↔projects relation can backfill
-- without another migration. Path A (guest_calls) already carries
-- customer_user_id / claimed_by / project_id on its own row.

ALTER TABLE public.call_recordings
  ADD COLUMN IF NOT EXISTS builder_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS engineer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id  uuid REFERENCES public.projects(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS call_recordings_builder_idx  ON public.call_recordings(builder_id);
CREATE INDEX IF NOT EXISTS call_recordings_engineer_idx ON public.call_recordings(engineer_id);
CREATE INDEX IF NOT EXISTS call_recordings_project_idx  ON public.call_recordings(project_id);

UPDATE public.call_recordings cr
SET
  builder_id  = COALESCE(cr.builder_id,  cs.builder_id),
  engineer_id = COALESCE(cr.engineer_id, cs.engineer_id)
FROM public.call_sessions cs
WHERE cr.call_session_id = cs.id
  AND (cr.builder_id IS NULL OR cr.engineer_id IS NULL);

UPDATE public.call_recordings cr
SET
  builder_id  = COALESCE(cr.builder_id,  r.builder_id),
  engineer_id = COALESCE(cr.engineer_id, r.assigned_engineer_id)
FROM public.requests r
WHERE cr.request_id = r.id
  AND (cr.builder_id IS NULL OR cr.engineer_id IS NULL);
