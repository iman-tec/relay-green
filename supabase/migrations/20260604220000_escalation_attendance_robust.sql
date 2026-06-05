-- ============================================================================
-- Make "supervisor attended" race-proof
-- ============================================================================
-- A very short session can end (auto-resolving its escalation) in the window
-- between a supervisor clicking "Join call" and the join RPC committing. Two
-- changes so the supervisor is still credited:
--   1. supervisor_join_escalation now stamps the supervisor on the session's
--      latest escalation REGARDLESS of status (incl. already-resolved), without
--      reopening a closed one.
--   2. A trigger clears guest_calls.escalated_unattended the moment any
--      escalation for the session gains a supervisor (ack or join) — even if
--      that happens after the session ended + was flagged.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_join_escalation(_session_id uuid)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me         uuid := auth.uid();
  _row        public.session_escalations;
  _name       text;
  _was_active boolean;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;

  -- Latest escalation for the session, whatever its status.
  SELECT * INTO _row
    FROM public.session_escalations
   WHERE session_id = _session_id
   ORDER BY created_at DESC
   LIMIT 1;
  IF _row.id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Already credited → idempotent no-op.
  IF _row.supervisor_user_id IS NOT NULL AND _row.joined_at IS NOT NULL THEN
    RETURN _row;
  END IF;

  _was_active := _row.status IN ('open', 'acked');

  UPDATE public.session_escalations
     SET supervisor_user_id = COALESCE(supervisor_user_id, _me),
         acked_at           = COALESCE(acked_at, now()),
         joined_at          = COALESCE(joined_at, now()),
         -- only a still-active escalation flips to 'joined'; a resolved /
         -- cancelled one keeps its terminal status.
         status             = CASE WHEN status IN ('open', 'acked') THEN 'joined' ELSE status END
   WHERE id = _row.id
   RETURNING * INTO _row;

  -- Customer-visible system line only when actually stepping into a live one.
  IF _was_active THEN
    SELECT COALESCE(NULLIF(btrim(full_name), ''), 'A supervisor')
      INTO _name FROM public.profiles WHERE id = _me;
    INSERT INTO public.guest_messages (guest_call_id, sender_kind, sender_name, body)
    VALUES (_row.session_id, 'system', 'Relay',
            COALESCE(_name, 'A supervisor') || ' joined to help.');
  END IF;

  RETURN _row;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_join_escalation(uuid) TO authenticated;

-- Safety net: clear the session's "no supervisor joined" flag whenever an
-- escalation for it gains a supervisor (set on acknowledge AND join). Only
-- touches escalated_unattended → does NOT re-fire the status-keyed triggers.
CREATE OR REPLACE FUNCTION public.clear_escalated_unattended_on_engage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.supervisor_user_id IS NOT NULL OR NEW.joined_at IS NOT NULL THEN
    UPDATE public.guest_calls
       SET escalated_unattended = false
     WHERE id = NEW.session_id
       AND escalated_unattended = true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clear_escalated_unattended ON public.session_escalations;
CREATE TRIGGER trg_clear_escalated_unattended
  AFTER INSERT OR UPDATE ON public.session_escalations
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_escalated_unattended_on_engage();

COMMIT;
