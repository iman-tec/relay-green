-- ============================================================================
-- Notify pod supervisors when an engineer raises a hand (escalation)
-- ============================================================================
-- When an engineer escalates a live session, drop a row into public.notifications
-- for every supervisor who shares the engineer's pod. That feeds the supervisor
-- notification bell (which renders any notification addressed to the user) so an
-- escalation is recorded there, not just as a transient toast.
--
-- Fires on INSERT only — re-escalating an existing open escalation refreshes the
-- row via UPDATE (see engineer_escalate_session) and shouldn't re-notify.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_supervisors_on_escalation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _eng_name  text;
  _cust_name text;
  _body      text;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(display_alias, 'An engineer')
    INTO _eng_name
    FROM engineer_profiles
   WHERE user_id = NEW.engineer_user_id;

  SELECT COALESCE(NULLIF(btrim(guest_name), ''), 'a customer')
    INTO _cust_name
    FROM guest_calls
   WHERE id = NEW.session_id;

  _body := COALESCE(_eng_name, 'An engineer')
        || ' raised a hand on ' || COALESCE(_cust_name, 'a session')
        || CASE
             WHEN NEW.reason IS NOT NULL AND btrim(NEW.reason) <> ''
               THEN ' — ' || btrim(NEW.reason)
             ELSE ''
           END;

  PERFORM public.notify_engineer_supervisors(
    NEW.engineer_user_id,
    'escalation',
    'Engineer needs help',
    _body
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_supervisors_on_escalation ON public.session_escalations;
CREATE TRIGGER trg_notify_supervisors_on_escalation
  AFTER INSERT ON public.session_escalations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_supervisors_on_escalation();

COMMIT;
