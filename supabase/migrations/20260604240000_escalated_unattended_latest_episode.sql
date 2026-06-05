-- ============================================================================
-- "No supervisor joined" keys off the LATEST escalation episode
-- ============================================================================
-- An escalation now stays visible (open/acked/joined) until a supervisor
-- RESOLVES it, so a supervisor can rejoin after navigating away. But the
-- session can be RE-escalated after a resolve — and if no supervisor joins that
-- new episode, it should flag "Escalated · No supervisor joined" even though an
-- earlier (resolved) episode was attended. So the flag looks only at the most
-- recent escalation for the session, not "any escalation ever".
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.flag_escalated_unattended()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('ended', 'cancelled', 'abandoned')
     AND COALESCE(OLD.status, '') <> NEW.status THEN
    -- Latest escalation episode: unattended if its supervisor was never set
    -- (no acknowledge, no join). No escalation at all → not flagged.
    NEW.escalated_unattended := COALESCE((
      SELECT (se.supervisor_user_id IS NULL AND se.joined_at IS NULL)
        FROM public.session_escalations se
       WHERE se.session_id = NEW.id
       ORDER BY se.created_at DESC
       LIMIT 1
    ), false);
  END IF;
  RETURN NEW;
END $$;

-- Re-evaluate already-ended sessions under the latest-episode rule.
UPDATE public.guest_calls gc
   SET escalated_unattended = COALESCE((
         SELECT (se.supervisor_user_id IS NULL AND se.joined_at IS NULL)
           FROM public.session_escalations se
          WHERE se.session_id = gc.id
          ORDER BY se.created_at DESC
          LIMIT 1
       ), false)
 WHERE gc.status IN ('ended', 'cancelled', 'abandoned')
   AND EXISTS (
     SELECT 1 FROM public.session_escalations se WHERE se.session_id = gc.id
   );

COMMIT;
