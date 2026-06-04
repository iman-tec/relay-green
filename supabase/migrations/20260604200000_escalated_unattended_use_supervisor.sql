-- ============================================================================
-- Refine the "escalated · no supervisor joined" flag
-- ============================================================================
-- Original rule keyed strictly on session_escalations.joined_at, but a
-- supervisor who acknowledges from the toast and opens the session can have the
-- call end before joined_at is stamped (race) — yet they DID engage. Treat an
-- escalation as ATTENDED when a supervisor picked it up at all, i.e. when
-- supervisor_user_id (set on acknowledge AND on join) or joined_at is present.
-- ============================================================================

BEGIN;

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
         WHERE se.session_id = NEW.id
           AND (se.supervisor_user_id IS NOT NULL OR se.joined_at IS NOT NULL)
      );
  END IF;
  RETURN NEW;
END $$;

-- Re-evaluate every already-ended escalated session under the new rule.
UPDATE public.guest_calls gc
   SET escalated_unattended = NOT EXISTS (
         SELECT 1 FROM public.session_escalations se
          WHERE se.session_id = gc.id
            AND (se.supervisor_user_id IS NOT NULL OR se.joined_at IS NOT NULL)
       )
 WHERE gc.status IN ('ended', 'cancelled', 'abandoned')
   AND EXISTS (
     SELECT 1 FROM public.session_escalations se WHERE se.session_id = gc.id
   );

COMMIT;
