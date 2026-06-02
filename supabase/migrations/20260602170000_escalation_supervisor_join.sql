-- ============================================================================
-- Escalation supervisor pull-in — acked / joined states + assigned supervisor
-- ============================================================================
-- The client (StaffShell toast → acknowledge_escalation, and the session view's
-- auto-mark-joined effect → mark_escalation_joined) was shipped against a
-- session_escalations shape that never landed in a migration:
--   • session_escalations.supervisor_user_id  (who picked the escalation up)
--   • status values 'acked' and 'joined'
--   • RPCs acknowledge_escalation() and mark_escalation_joined()
-- The result was a 42703 ("column does not exist") on the session view and a
-- dead pull-in flow. This migration adds the columns + states + RPCs so the
-- open → acked → joined → resolved lifecycle works end to end.
--
-- Lifecycle:
--   open     engineer raised a hand (engineer_escalate_session)
--   acked    a supervisor claimed it (acknowledge_escalation) — first wins
--   joined   that supervisor opened the live session (mark_escalation_joined),
--            which also drops a customer-visible system chat line
--   resolved supervisor closed it with a note (resolve_escalation)
--   cancelled engineer or supervisor cancelled (cancel_escalation)
-- ============================================================================

BEGIN;

-- ── Columns ────────────────────────────────────────────────────────────────
ALTER TABLE public.session_escalations
  ADD COLUMN IF NOT EXISTS supervisor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz;

-- Widen the status check to include the pull-in states.
ALTER TABLE public.session_escalations
  DROP CONSTRAINT IF EXISTS session_escalations_status_check;
ALTER TABLE public.session_escalations
  ADD CONSTRAINT session_escalations_status_check
  CHECK (status IN ('open', 'acked', 'joined', 'resolved', 'cancelled'));

-- The supervisor's "what have I picked up" lookups filter on this.
CREATE INDEX IF NOT EXISTS idx_session_escalations_supervisor
  ON public.session_escalations (supervisor_user_id, status);

-- ── RPC: acknowledge_escalation (supervisor claims an open escalation) ───────
-- First supervisor wins: the UPDATE is guarded on status='open', so a second
-- acker gets ALREADY_TAKEN. Stamps the claimer as supervisor_user_id.
CREATE OR REPLACE FUNCTION public.acknowledge_escalation(_id uuid)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;

  UPDATE session_escalations
     SET status = 'acked', supervisor_user_id = _me, acked_at = now()
   WHERE id = _id AND status = 'open'
   RETURNING * INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'ALREADY_TAKEN' USING ERRCODE='P0001';
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.acknowledge_escalation(uuid) TO authenticated;

-- ── RPC: mark_escalation_joined (acking supervisor opened the session) ───────
-- Idempotent: guarded on status IN ('open','acked') so a re-open (component
-- remount) after status='joined' is a no-op and never double-posts the system
-- message. Only the supervisor who acked may join.
CREATE OR REPLACE FUNCTION public.mark_escalation_joined(_id uuid)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me      uuid := auth.uid();
  _name    text;
  result   public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  UPDATE session_escalations
     SET status = 'joined', joined_at = now()
   WHERE id = _id
     AND supervisor_user_id = _me
     AND status IN ('open', 'acked')
   RETURNING * INTO result;

  -- No row → already joined / not the acking supervisor → no-op (idempotent).
  IF result.id IS NULL THEN
    SELECT * INTO result FROM session_escalations WHERE id = _id;
    RETURN result;
  END IF;

  -- Customer-visible system chat line so the customer knows help arrived.
  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'A supervisor')
    INTO _name FROM profiles WHERE id = _me;

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (
    result.session_id,
    'system',
    'Relay',
    COALESCE(_name, 'A supervisor') || ' joined to help.'
  );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_escalation_joined(uuid) TO authenticated;

-- ── Let resolve / cancel act on acked + joined escalations too ───────────────
-- The originals only updated WHERE status='open'; once an escalation is acked
-- or joined a supervisor could no longer resolve it. Broaden the guard.
CREATE OR REPLACE FUNCTION public.resolve_escalation(_id uuid, _note text)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;

  UPDATE session_escalations
     SET status = 'resolved', resolution_note = NULLIF(btrim(_note), ''),
         resolved_by = _me, resolved_at = now()
   WHERE id = _id AND status IN ('open', 'acked', 'joined')
   RETURNING * INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'ESCALATION_NOT_OPEN' USING ERRCODE='P0001';
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_escalation(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_escalation(_id uuid)
RETURNS public.session_escalations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me     uuid := auth.uid();
  result  public.session_escalations;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  UPDATE session_escalations
     SET status = 'cancelled', resolved_by = _me, resolved_at = now()
   WHERE id = _id AND status IN ('open', 'acked', 'joined')
     AND (
       engineer_user_id = _me
       OR has_role(_me, 'supervisor') OR has_role(_me, 'admin') OR has_role(_me, 'super_admin')
     )
   RETURNING * INTO result;
  IF result.id IS NULL THEN
    RAISE EXCEPTION 'ESCALATION_NOT_OPEN_OR_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_escalation(uuid) TO authenticated;

COMMIT;
