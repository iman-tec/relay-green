-- ============================================================================
-- Zoom Video SDK schema (additive, sits beside the Meeting SDK columns)
-- ============================================================================
-- New scaffolding for the Video-SDK-side migration:
--
--   guest_calls.video_topic        text        derived 'relay-session-<id>',
--                                              stamped by zoom-video-sdk-token
--                                              on first call, never overwritten.
--   guest_calls.video_started_at   timestamptz set by session.started webhook.
--   guest_calls.video_ended_at     timestamptz set by session.ended webhook
--                                              (and the engineer's "end for all"
--                                              RPC).
--   call_sessions.session_key      text        Video SDK session_key claim. The
--                                              webhook handler upserts on this
--                                              instead of zoom_meeting_id so the
--                                              new flow doesn't collide with the
--                                              existing Meeting-SDK ledger rows.
--   session_video_events           audit log mirroring session_captions' RLS.
--
-- Everything is additive. Meeting-SDK columns (zoom_meeting_id, zoom_join_url,
-- zoom_start_url, recording_*) stay untouched and continue to serve the live
-- traffic until B6 cutover.
-- ============================================================================

BEGIN;

-- ── guest_calls: Video SDK lifecycle stamps ────────────────────────────────
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS video_topic       text,
  ADD COLUMN IF NOT EXISTS video_started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS video_ended_at    timestamptz;

CREATE INDEX IF NOT EXISTS idx_guest_calls_video_topic
  ON public.guest_calls (video_topic)
  WHERE video_topic IS NOT NULL;

-- ── call_sessions: session_key for the Video-SDK webhook upsert ────────────
ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS session_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_sessions_session_key
  ON public.call_sessions (session_key)
  WHERE session_key IS NOT NULL;

-- ── session_video_events: audit log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_video_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_call_id  uuid        NOT NULL REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  kind           text        NOT NULL,
  actor_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_video_events_session
  ON public.session_video_events (guest_call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_video_events_kind_created
  ON public.session_video_events (kind, created_at DESC);

ALTER TABLE public.session_video_events ENABLE ROW LEVEL SECURITY;

-- Customer sees events for sessions they own (customer_user_id), engineer sees
-- events for sessions they claimed. Mirrors the session_captions RLS shape.
DROP POLICY IF EXISTS session_video_events_owner_read ON public.session_video_events;
CREATE POLICY session_video_events_owner_read
  ON public.session_video_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_calls gc
      WHERE gc.id = session_video_events.guest_call_id
        AND (gc.customer_user_id = auth.uid() OR gc.claimed_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS session_video_events_staff_read ON public.session_video_events;
CREATE POLICY session_video_events_staff_read
  ON public.session_video_events FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- Writes happen via service-role from edge functions only; no INSERT policy.

COMMIT;
