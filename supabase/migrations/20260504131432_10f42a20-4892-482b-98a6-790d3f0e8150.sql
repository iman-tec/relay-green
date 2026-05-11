-- Persist Zoom cloud recordings + AI Companion summaries per call session
CREATE TABLE IF NOT EXISTS public.call_recordings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_session_id UUID,
  request_id UUID NOT NULL,
  zoom_meeting_id TEXT NOT NULL,
  recording_play_url TEXT,
  recording_download_url TEXT,
  recording_password TEXT,
  duration_minutes INTEGER,
  recording_files JSONB,
  ai_summary_title TEXT,
  ai_summary_overview TEXT,
  ai_summary_details JSONB,
  ai_next_steps JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS call_recordings_zoom_meeting_id_key
  ON public.call_recordings(zoom_meeting_id);

CREATE INDEX IF NOT EXISTS call_recordings_request_id_idx
  ON public.call_recordings(request_id);

ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View recordings on visible requests"
  ON public.call_recordings
  FOR SELECT
  TO authenticated
  USING (public.can_view_request(request_id, auth.uid()));

CREATE TRIGGER call_recordings_set_updated_at
  BEFORE UPDATE ON public.call_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();