-- ============================================================================
-- Flag sessions that were escalated but no supervisor ever joined
-- ============================================================================
-- If an engineer raises a hand and the call ends before any supervisor joins
-- (session_escalations.joined_at stays NULL across all the session's
-- escalations), mark the session so the Past card can call it out:
--   "Escalated · No supervisor joined the call"  (instead of the AI summary).
--
-- Computed in a BEFORE UPDATE trigger as the session transitions to a terminal
-- state, so it's stamped on the row itself (no client guesswork).
-- ============================================================================

BEGIN;

ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS escalated_unattended boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.flag_escalated_unattended()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('ended', 'cancelled', 'abandoned')
     AND COALESCE(OLD.status, '') <> NEW.status THEN
    NEW.escalated_unattended :=
      EXISTS (
        SELECT 1 FROM public.session_escalations se
         WHERE se.session_id = NEW.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.session_escalations se
         WHERE se.session_id = NEW.id AND se.joined_at IS NOT NULL
      );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_flag_escalated_unattended ON public.guest_calls;
CREATE TRIGGER trg_flag_escalated_unattended
  BEFORE UPDATE OF status ON public.guest_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_escalated_unattended();

-- Backfill already-ended sessions.
UPDATE public.guest_calls gc
   SET escalated_unattended = true
 WHERE gc.status IN ('ended', 'cancelled', 'abandoned')
   AND EXISTS (
     SELECT 1 FROM public.session_escalations se WHERE se.session_id = gc.id
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.session_escalations se
      WHERE se.session_id = gc.id AND se.joined_at IS NOT NULL
   );

COMMIT;
