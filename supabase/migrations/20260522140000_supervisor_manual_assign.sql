-- ============================================================================
-- Supervisor manual matching override  (master-prompt §4.3)
-- ============================================================================
-- The matcher is otherwise fully automatic (match_engineer → sequential
-- ring → accept_match). This adds a supervisor/admin escape hatch:
--
--   supervisor_assign_engineer(_intake_id, _engineer_user_id)
--       Force-assign a ringing call to a chosen engineer. Cancels the
--       automatic matching for that call (supersedes every other pending
--       offer) and claims the session for the engineer — same end-state as
--       accept_match, just driven by staff instead of the engineer tapping
--       "Accept".
--
--   supervisor_cancel_call(_intake_id)
--       Drop a ringing call entirely (e.g. spam, duplicate). Marks the
--       session cancelled and expires its pending offers.
--
--   supervisor_assignments
--       Immutable audit trail of every manual override.
-- ============================================================================

BEGIN;

-- ── Audit table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supervisor_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id            uuid REFERENCES public.client_intakes(id) ON DELETE SET NULL,
  guest_call_id        uuid REFERENCES public.guest_calls(id)    ON DELETE SET NULL,
  supervisor_user_id   uuid REFERENCES auth.users(id)            ON DELETE SET NULL,
  assigned_engineer_id uuid REFERENCES auth.users(id)            ON DELETE SET NULL,
  action               text NOT NULL DEFAULT 'assign'
                          CHECK (action IN ('assign','cancel')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_assignments_call
  ON public.supervisor_assignments (guest_call_id, created_at DESC);

ALTER TABLE public.supervisor_assignments ENABLE ROW LEVEL SECURITY;

-- Staff may read the override log. Inserts only happen inside the
-- SECURITY DEFINER RPCs below, so no INSERT policy is granted.
DROP POLICY IF EXISTS "Staff read supervisor assignments" ON public.supervisor_assignments;
CREATE POLICY "Staff read supervisor assignments" ON public.supervisor_assignments
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── Authority helper ────────────────────────────────────────────────────────
-- Can _caller force-assign work to _engineer?
--   • admin / ops_manager / super_admin → any engineer
--   • supervisor / pod_lead             → only engineers in a pod they run
CREATE OR REPLACE FUNCTION public._can_manually_assign(_caller uuid, _engineer uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF has_role(_caller, 'super_admin')
     OR has_role(_caller, 'admin')
     OR has_role(_caller, 'ops_manager') THEN
    RETURN true;
  END IF;

  IF has_role(_caller, 'supervisor') OR has_role(_caller, 'pod_lead') THEN
    RETURN EXISTS (
      SELECT 1
        FROM pod_members sup
        JOIN pod_members eng ON eng.pod_id = sup.pod_id
       WHERE sup.user_id = _caller
         AND sup.pod_role IN ('supervisor','pod_lead')
         AND eng.user_id = _engineer
         AND eng.pod_role = 'engineer'
    );
  END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public._can_manually_assign(uuid, uuid) TO authenticated;


-- ── RPC: supervisor_assign_engineer ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supervisor_assign_engineer(
  _intake_id        uuid,
  _engineer_user_id uuid
)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _caller        uuid := auth.uid();
  _intake        public.client_intakes;
  _session       public.guest_calls;
  _engineer_name text;
  _pod           uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  -- Authority: staff role + (for supervisors) engineer in their pod.
  IF NOT public._can_manually_assign(_caller, _engineer_user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  -- Target engineer must actually be an engineer.
  IF NOT has_role(_engineer_user_id, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;

  -- Don't double-book an engineer who's already on a live call.
  IF EXISTS (
    SELECT 1 FROM guest_calls
    WHERE claimed_by = _engineer_user_id
      AND status IN ('assigned','joining','live','grace','expired_free','ending')
  ) THEN
    RAISE EXCEPTION 'ENGINEER_BUSY' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(NULLIF(full_name,''),'Engineer') INTO _engineer_name
    FROM profiles WHERE id = _engineer_user_id;
  SELECT pod_id INTO _pod
    FROM pod_members WHERE user_id = _engineer_user_id LIMIT 1;

  -- Claim the session for the chosen engineer. Same end-state as
  -- accept_match. Only a still-ringing (queued) session can be overridden.
  UPDATE guest_calls SET
    status      = 'assigned',
    claimed_by  = _engineer_user_id,
    claimed_at  = now(),
    assigned_at = now(),
    agent_name  = COALESCE(_engineer_name, 'Engineer'),
    pod_id      = _pod,
    updated_at  = now()
  WHERE id = _intake.guest_call_id
    AND status = 'queued'
  RETURNING * INTO _session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Record the engineer's offer as accepted (flip an existing pending one,
  -- else synthesize an accepted row so the audit chain is complete).
  UPDATE engineer_match_offers
     SET status = 'accepted', responded_at = now()
   WHERE intake_id = _intake.id
     AND engineer_user_id = _engineer_user_id
     AND status = 'pending';
  IF NOT FOUND THEN
    INSERT INTO engineer_match_offers (
      intake_id, guest_call_id, engineer_user_id, customer_user_id,
      status, match_score, responded_at
    ) VALUES (
      _intake.id, _intake.guest_call_id, _engineer_user_id,
      _intake.customer_user_id, 'accepted', 0, now()
    );
  END IF;

  -- Cancel the automatic matching: supersede every other pending offer.
  -- advance_match_on_offer_close_trg fires on these, but the session is now
  -- 'assigned' (not 'queued') so it no-ops — no next engineer is rung.
  UPDATE engineer_match_offers
     SET status = 'expired', responded_at = now()
   WHERE intake_id = _intake.id
     AND status = 'pending'
     AND engineer_user_id <> _engineer_user_id;

  -- Audit + session-log + customer-visible system line.
  INSERT INTO supervisor_assignments
    (intake_id, guest_call_id, supervisor_user_id, assigned_engineer_id, action)
  VALUES
    (_intake.id, _intake.guest_call_id, _caller, _engineer_user_id, 'assign');

  PERFORM _log_session_event(
    _session.id, 'session.claimed', 'queued', 'assigned',
    jsonb_build_object(
      'engineer_id',   _engineer_user_id,
      'engineer_name', _engineer_name,
      'via',           'supervisor_assign',
      'supervisor_id', _caller
    )
  );

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session.id, 'system', 'Relay',
          format('👤 %s was connected by your supervisor', COALESCE(_engineer_name, 'Engineer')));

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_assign_engineer(uuid, uuid) TO authenticated;


-- ── RPC: supervisor_cancel_call ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supervisor_cancel_call(_intake_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _caller   uuid := auth.uid();
  _intake   public.client_intakes;
  _session  public.guest_calls;
  _from     text;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  -- Any matching-capable staff role can cancel (no per-engineer scoping).
  IF NOT (
    has_role(_caller, 'supervisor') OR has_role(_caller, 'pod_lead')
    OR has_role(_caller, 'ops_manager') OR has_role(_caller, 'admin')
    OR has_role(_caller, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;

  SELECT status INTO _from FROM guest_calls WHERE id = _intake.guest_call_id;

  UPDATE guest_calls SET
    status       = 'cancelled',
    cancelled_at = now(),
    ended_reason = 'supervisor_cancelled',
    updated_at   = now()
  WHERE id = _intake.guest_call_id
    AND status IN ('queued','assigned')
  RETURNING * INTO _session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  UPDATE engineer_match_offers
     SET status = 'expired', responded_at = now()
   WHERE intake_id = _intake.id
     AND status = 'pending';

  INSERT INTO supervisor_assignments
    (intake_id, guest_call_id, supervisor_user_id, assigned_engineer_id, action)
  VALUES
    (_intake.id, _intake.guest_call_id, _caller, NULL, 'cancel');

  PERFORM _log_session_event(
    _session.id, 'session.cancelled', COALESCE(_from, 'queued'), 'cancelled',
    jsonb_build_object('via', 'supervisor_cancel', 'supervisor_id', _caller)
  );

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_cancel_call(uuid) TO authenticated;

COMMIT;
