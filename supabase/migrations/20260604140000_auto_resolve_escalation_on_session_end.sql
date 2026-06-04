-- ============================================================================
-- Auto-resolve open escalations when their session ends
-- ============================================================================
-- An engineer escalation stays open until a supervisor resolves it — but if the
-- session ends first, the escalation is moot and should close itself. Otherwise
-- it lingers in the Escalations tab / All "Escalated" group pointing at a dead
-- session (with a "Join call" button + a still-counting timer).
--
-- Fires when guest_calls.status transitions into a terminal state.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_resolve_escalations_on_session_end()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('ended', 'cancelled', 'abandoned')
     AND COALESCE(OLD.status, '') <> NEW.status THEN
    UPDATE public.session_escalations
       SET status          = 'resolved',
           resolution_note = COALESCE(resolution_note, 'Auto-resolved: session ended'),
           resolved_at     = now()
     WHERE session_id = NEW.id
       AND status = 'open';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_resolve_escalations_on_session_end ON public.guest_calls;
CREATE TRIGGER trg_auto_resolve_escalations_on_session_end
  AFTER UPDATE OF status ON public.guest_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_resolve_escalations_on_session_end();

-- One-time cleanup: close any escalations already left open on ended sessions.
UPDATE public.session_escalations se
   SET status          = 'resolved',
       resolution_note = COALESCE(se.resolution_note, 'Auto-resolved: session ended'),
       resolved_at     = now()
  FROM public.guest_calls gc
 WHERE se.session_id = gc.id
   AND se.status = 'open'
   AND gc.status IN ('ended', 'cancelled', 'abandoned');

COMMIT;
