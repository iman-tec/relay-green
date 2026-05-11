
ALTER TABLE public.request_messages
  ADD COLUMN IF NOT EXISTS meeting_topic text,
  ADD COLUMN IF NOT EXISTS meeting_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS meeting_join_url text,
  ADD COLUMN IF NOT EXISTS meeting_host_email text,
  ADD COLUMN IF NOT EXISTS meeting_zoom_id text;
