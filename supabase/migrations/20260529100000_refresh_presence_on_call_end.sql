-- ============================================================================
-- Refresh engineer_presence when their call ends
-- ============================================================================
-- Bug: engineer accepts a call, the dashboard tab gets backgrounded during
-- the Zoom session (heartbeat stops via the document.hidden gate), call
-- ends, and within 5–10 seconds the cron reaper flips the engineer to
-- offline. Audit confirms: no busy→online transition happens — the offline
-- flip races (and beats) the client's auto-watcher restore.
--
-- Trace:
--   1. Engineer online; heartbeat fresh. Tab visible.
--   2. Call assigned + accepted. claimed_by=engineer.
--   3. During call: dashboard tab is hidden (Zoom client takes focus / new
--      window / picture-in-picture). useEngineerHeartbeat skips pings →
--      engineer_presence.last_seen_at goes stale.
--   4. Cron reaper fires every 10s. SKIPS this engineer because they have
--      an active claimed guest_call (the exclusion added in 20260528190000).
--   5. Call ends → guest_calls.status flips to terminal.
--   6. ~5s later, next cron tick: active-call exclusion no longer matches.
--      last_seen_at is still ~90s stale. Reaper flips engineer to offline.
--
-- The client's auto-watcher restore-to-online MIGHT fire in this window,
-- but it races the reaper and isn't guaranteed (e.g. when the auto-watcher
-- on the dashboard tab missed the call entirely because the tab was closed
-- mid-call).
--
-- Fix: a trigger on guest_calls that refreshes engineer_presence.last_seen_at
-- for the claimed_by engineer when status transitions to a terminal value.
-- This gives them a fresh 30-second window post-call. If they're truly at
-- the device, their next heartbeat keeps the window fresh and they stay
-- online. If they walked away mid-call, the window expires after 30s and
-- the reaper flips them offline as usual — just delayed by 30s instead of
-- firing 5s after call-end.
--
-- Important: this fires AFTER guest_calls.status changes, which means the
-- engineer is no longer "on a call" by the reaper's exclusion check. So
-- this is the ONLY window where the reaper could (incorrectly) catch them
-- with stale presence. Refreshing here closes the window.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_engineer_presence_on_call_end()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'ended', 'abandoned')
     AND OLD.status NOT IN ('cancelled', 'ended', 'abandoned')
     AND NEW.claimed_by IS NOT NULL
  THEN
    -- Refresh the engineer's presence row so the cron reaper, on its
    -- next tick, sees a fresh last_seen_at and doesn't reap them just
    -- because the active-call exclusion lifted at the same instant.
    -- focused=true is a sensible default: they were on a call moments ago,
    -- they're presumed available. Their next real heartbeat (within 10s)
    -- will correct the focused flag.
    INSERT INTO public.engineer_presence (engineer_id, last_seen_at, focused)
    VALUES (NEW.claimed_by, now(), true)
    ON CONFLICT (engineer_id) DO UPDATE
      SET last_seen_at = now(),
          focused      = true,
          updated_at   = now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS refresh_engineer_presence_on_call_end_trg ON public.guest_calls;
CREATE TRIGGER refresh_engineer_presence_on_call_end_trg
  AFTER UPDATE OF status ON public.guest_calls
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.refresh_engineer_presence_on_call_end();

COMMIT;
