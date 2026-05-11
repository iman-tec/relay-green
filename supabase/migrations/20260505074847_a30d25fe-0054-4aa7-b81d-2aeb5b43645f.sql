
-- 1. guest_threads table
CREATE TABLE public.guest_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_email TEXT,
  guest_local_id TEXT,
  display_name TEXT NOT NULL,
  rolling_brief TEXT,
  brief_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX guest_threads_email_uniq ON public.guest_threads(lower(guest_email)) WHERE guest_email IS NOT NULL;
CREATE UNIQUE INDEX guest_threads_local_uniq ON public.guest_threads(guest_local_id) WHERE guest_local_id IS NOT NULL;

ALTER TABLE public.guest_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read guest_threads" ON public.guest_threads
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Staff update guest_threads" ON public.guest_threads
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'engineer') OR has_role(auth.uid(),'pod_lead') OR has_role(auth.uid(),'ops_manager') OR has_role(auth.uid(),'admin'));

CREATE TRIGGER guest_threads_set_updated_at
  BEFORE UPDATE ON public.guest_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. extend guest_calls
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES public.guest_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_local_id TEXT,
  ADD COLUMN IF NOT EXISTS agent_name TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_title TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_overview TEXT,
  ADD COLUMN IF NOT EXISTS ai_next_steps JSONB,
  ADD COLUMN IF NOT EXISTS recording_play_url TEXT,
  ADD COLUMN IF NOT EXISTS recording_password TEXT,
  ADD COLUMN IF NOT EXISTS duration_minutes NUMERIC;

CREATE INDEX IF NOT EXISTS guest_calls_thread_idx ON public.guest_calls(thread_id);
CREATE INDEX IF NOT EXISTS guest_calls_zoom_idx ON public.guest_calls(zoom_meeting_id);

-- 3. find_or_create_guest_thread
CREATE OR REPLACE FUNCTION public.find_or_create_guest_thread(
  _email TEXT,
  _local_id TEXT,
  _display_name TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread_id UUID;
BEGIN
  IF _email IS NOT NULL AND length(trim(_email)) > 0 THEN
    SELECT id INTO thread_id FROM public.guest_threads WHERE lower(guest_email) = lower(_email) LIMIT 1;
  END IF;

  IF thread_id IS NULL AND _local_id IS NOT NULL AND length(_local_id) > 0 THEN
    SELECT id INTO thread_id FROM public.guest_threads WHERE guest_local_id = _local_id LIMIT 1;
  END IF;

  IF thread_id IS NULL THEN
    INSERT INTO public.guest_threads (guest_email, guest_local_id, display_name)
    VALUES (NULLIF(_email,''), NULLIF(_local_id,''), COALESCE(_display_name,'Guest'))
    RETURNING id INTO thread_id;
  ELSE
    UPDATE public.guest_threads
       SET display_name = COALESCE(_display_name, display_name),
           guest_email = COALESCE(guest_email, NULLIF(_email,'')),
           guest_local_id = COALESCE(guest_local_id, NULLIF(_local_id,'')),
           updated_at = now()
     WHERE id = thread_id;
  END IF;

  RETURN thread_id;
END;
$$;
