-- ============================================================================
-- supervisor_join_escalation — mark a session's escalation joined on "Join call"
-- ============================================================================
-- The /supervise "Join call" button drops a supervisor into a session with chat
-- unlocked (?join=1) WITHOUT going through the ack-then-join toast flow, so
-- session_escalations.joined_at was never stamped — which made the
-- "Escalated · No supervisor joined" flag fire even though a supervisor did
-- join + chat. This RPC joins the latest still-active escalation for a session
-- directly (ack + join in one step), idempotently.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.supervisor_join_escalation(_session_id uuid)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me   uuid := auth.uid();
  _row  public.session_escalations;
  _name text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;

  -- Newest not-yet-closed escalation for the session.
  SELECT * INTO _row
    FROM public.session_escalations
   WHERE session_id = _session_id
     AND status IN ('open', 'acked', 'joined')
   ORDER BY created_at DESC
   LIMIT 1;

  IF _row.id IS NULL THEN
    RETURN NULL;                       -- nothing active to join
  END IF;
  IF _row.joined_at IS NOT NULL THEN
    RETURN _row;                       -- already joined — idempotent no-op
  END IF;

  UPDATE public.session_escalations
     SET status             = 'joined',
         supervisor_user_id = COALESCE(supervisor_user_id, _me),
         acked_at           = COALESCE(acked_at, now()),
         joined_at          = now()
   WHERE id = _row.id
   RETURNING * INTO _row;

  -- Customer-visible system line, posted once (joined_at was NULL above).
  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'A supervisor')
    INTO _name FROM public.profiles WHERE id = _me;

  INSERT INTO public.guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_row.session_id, 'system', 'Relay',
          COALESCE(_name, 'A supervisor') || ' joined to help.');

  RETURN _row;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_join_escalation(uuid) TO authenticated;

COMMIT;
