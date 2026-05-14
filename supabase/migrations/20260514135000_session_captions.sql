-- Live captions captured from Zoom RTMS during a session.
--
-- One row per ~60s window of transcript text. The client-side RTMS gateway
-- (mounted on the engineer's session page, web or Electron) opens the
-- WebSocket to Zoom RTMS, buffers transcript frames per window, then
-- inserts a row here. Supervisors subscribe to this table via Supabase
-- Realtime on /supervise for live streaming captions.

CREATE TABLE IF NOT EXISTS public.session_captions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  -- Denormalised so we can window-lookup without joining guest_calls just
  -- to confirm the meeting id of a row.
  zoom_meeting_id text,
  -- Best-effort label of who was speaking during this window. May be the
  -- Zoom participant name, "engineer", "customer", or null if mixed/unknown.
  speaker         text,
  -- The transcribed text for the window. Plain UTF-8, no formatting.
  text            text NOT NULL,
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_captions_session_created
  ON public.session_captions(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_captions_zoom
  ON public.session_captions(zoom_meeting_id);

ALTER TABLE public.session_captions ENABLE ROW LEVEL SECURITY;

-- Customer reads captions for sessions they own.
DROP POLICY IF EXISTS "Customers read own session captions" ON public.session_captions;
CREATE POLICY "Customers read own session captions" ON public.session_captions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_calls c
      WHERE c.id = session_captions.session_id
        AND c.customer_user_id = auth.uid()
    )
  );

-- Staff (engineer / pod_lead / ops_manager / admin) read all captions —
-- supervisors need to see across sessions; engineers may need to scroll
-- back when reviewing.
DROP POLICY IF EXISTS "Staff read session_captions" ON public.session_captions;
CREATE POLICY "Staff read session_captions" ON public.session_captions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
  );

-- The assigned engineer's client writes captions for their session. This
-- lets the in-browser RTMS gateway (mounted on EngineerSessionClient)
-- insert directly using the engineer's auth, without going through an
-- edge function on the hot path.
DROP POLICY IF EXISTS "Assigned engineer inserts session captions" ON public.session_captions;
CREATE POLICY "Assigned engineer inserts session captions" ON public.session_captions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.guest_calls c
      WHERE c.id = session_captions.session_id
        AND c.claimed_by = auth.uid()
    )
  );
