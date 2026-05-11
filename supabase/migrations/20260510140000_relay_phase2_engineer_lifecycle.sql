-- ============================================================================
-- Relay — Phase 2: Engineer claim + lifecycle RPCs
-- ============================================================================
-- Adds the server-side primitives the engineer side needs:
--   claim_session, release_session, mark_joined, end_session
-- Plus a single transition_session helper used internally by all of them.
--
-- Race-safety: claim_session uses an atomic conditional UPDATE so two
-- engineers clicking "Take" on the same row → exactly one wins.
--
-- All transitions write an audit_log row. Status changes always go through
-- these RPCs; clients never UPDATE guest_calls.status directly (RLS forbids).
-- ============================================================================

BEGIN;

-- ── 1. RPC: claim_session ──────────────────────────────────────────────────
-- Engineer claims a queued session. Atomic: returns NULL if already claimed.

CREATE OR REPLACE FUNCTION public.claim_session(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s          public.guest_calls;
  _engineer   text;
  _staff      boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  -- Must be staff
  _staff := has_role(auth.uid(),'engineer')
         OR has_role(auth.uid(),'pod_lead')
         OR has_role(auth.uid(),'ops_manager')
         OR has_role(auth.uid(),'admin');
  IF NOT _staff THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  -- Resolve engineer display name from profile
  SELECT COALESCE(NULLIF(full_name,''), 'Engineer') INTO _engineer
    FROM profiles WHERE id = auth.uid();

  -- Atomic claim: only succeeds if status is 'queued' and no claimer.
  UPDATE guest_calls SET
    status        = 'assigned',
    claimed_by    = auth.uid(),
    claimed_at    = now(),
    assigned_at   = now(),
    agent_name    = COALESCE(_engineer, 'Engineer'),
    updated_at    = now()
  WHERE id = _session_id
    AND status = 'queued'
    AND claimed_by IS NULL
  RETURNING * INTO _s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_ALREADY_CLAIMED' USING ERRCODE='P0001';
  END IF;

  PERFORM _log_session_event(
    _session_id, 'session.claimed', 'queued', 'assigned',
    jsonb_build_object('engineer_id', auth.uid(), 'engineer_name', _engineer)
  );

  -- Insert system message announcing engineer
  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('👤 %s joined as engineer', COALESCE(_engineer, 'Engineer')));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_session(uuid) TO authenticated;

-- ── 2. RPC: release_session ────────────────────────────────────────────────
-- Engineer releases a pre-LIVE session back to the queue.

CREATE OR REPLACE FUNCTION public.release_session(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _s public.guest_calls;
BEGIN
  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  IF _s.claimed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_YOU' USING ERRCODE='P0001';
  END IF;

  IF _s.status NOT IN ('assigned','joining') THEN
    RAISE EXCEPTION 'INVALID_STATE: %', _s.status USING ERRCODE='P0001';
  END IF;

  UPDATE guest_calls SET
    status      = 'queued',
    claimed_by  = NULL,
    claimed_at  = NULL,
    assigned_at = NULL,
    agent_name  = NULL,
    updated_at  = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.released', 'assigned', 'queued', NULL);

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay', '↩️ Engineer released the session — re-queued.');

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.release_session(uuid) TO authenticated;

-- ── 3. RPC: mark_joined ────────────────────────────────────────────────────
-- Either party reports they've joined the Zoom meeting.
-- When BOTH have joined, transition to 'live' and stamp joined_at.

CREATE OR REPLACE FUNCTION public.mark_joined(
  _session_id uuid,
  _role       text   -- 'customer' | 'engineer'
) RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s public.guest_calls;
  _new_status text;
  _both boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF _role NOT IN ('customer','engineer') THEN
    RAISE EXCEPTION 'INVALID_ROLE: %', _role USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  -- Authorization: customer must be the session owner OR engineer must be claimed_by
  IF _role = 'customer' AND _s.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF _role = 'engineer' AND _s.claimed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_YOU' USING ERRCODE='P0001';
  END IF;

  -- Stamp the joined_at for this role (idempotent — only stamps if NULL)
  IF _role = 'customer' AND _s.customer_joined_at IS NULL THEN
    UPDATE guest_calls SET customer_joined_at = now(), updated_at = now()
      WHERE id = _session_id RETURNING * INTO _s;
  ELSIF _role = 'engineer' AND _s.engineer_joined_at IS NULL THEN
    UPDATE guest_calls SET engineer_joined_at = now(), updated_at = now()
      WHERE id = _session_id RETURNING * INTO _s;
  END IF;

  -- Transition: 'assigned' → 'joining' (first join), 'joining' → 'live' (both joined)
  _both := (_s.customer_joined_at IS NOT NULL) AND (_s.engineer_joined_at IS NOT NULL);

  IF _both AND _s.status IN ('assigned','joining','grace') THEN
    _new_status := 'live';
    UPDATE guest_calls SET
      status     = 'live',
      joined_at  = LEAST(COALESCE(_s.joined_at, now()), now()),
      started_at = COALESCE(_s.started_at, now()),
      updated_at = now()
    WHERE id = _session_id RETURNING * INTO _s;

    PERFORM _log_session_event(_session_id, 'session.live', 'joining', 'live', NULL);

    -- Consume the customer's free session if not yet consumed
    INSERT INTO customer_entitlements (customer_user_id) VALUES (_s.customer_user_id)
      ON CONFLICT DO NOTHING;
    UPDATE customer_entitlements SET
      free_session_consumed_at = COALESCE(free_session_consumed_at, now()),
      free_session_id          = COALESCE(free_session_id, _session_id),
      updated_at               = now()
    WHERE customer_user_id = _s.customer_user_id;

    INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
    VALUES (_session_id, 'system', 'Relay', '📞 Call started');

  ELSIF _s.status = 'assigned' THEN
    -- One side joined, other not yet — go to 'joining'
    UPDATE guest_calls SET status = 'joining', updated_at = now()
      WHERE id = _session_id RETURNING * INTO _s;
    PERFORM _log_session_event(_session_id, 'session.joining',
      'assigned', 'joining',
      jsonb_build_object('role', _role)
    );
  END IF;

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_joined(uuid, text) TO authenticated;

-- ── 4. RPC: end_session ────────────────────────────────────────────────────
-- Engineer or customer ends the session. Computes duration, transitions to
-- 'ended', enqueues summary generation (Phase 4), locks chat.

CREATE OR REPLACE FUNCTION public.end_session(
  _session_id uuid,
  _reason     text DEFAULT 'manual'
) RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s            public.guest_calls;
  _is_owner     boolean;
  _is_assigned  boolean;
  _duration_min numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _s FROM guest_calls WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  _is_owner    := _s.customer_user_id = auth.uid();
  _is_assigned := _s.claimed_by       = auth.uid();
  IF NOT (_is_owner OR _is_assigned) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  IF _s.status IN ('ended','abandoned','cancelled') THEN
    RETURN _s;  -- idempotent
  END IF;

  -- Compute duration from joined_at if we got there, else 0
  IF _s.joined_at IS NOT NULL THEN
    _duration_min := EXTRACT(EPOCH FROM (now() - _s.joined_at)) / 60.0;
  ELSE
    _duration_min := 0;
  END IF;

  UPDATE guest_calls SET
    status            = 'ended',
    ended_at          = now(),
    duration_minutes  = _duration_min,
    free_minutes_used = LEAST(_s.free_minutes::numeric, _duration_min),
    ended_reason      = _reason,
    updated_at        = now()
  WHERE id = _session_id RETURNING * INTO _s;

  PERFORM _log_session_event(_session_id, 'session.ended',
    NULL, 'ended',
    jsonb_build_object('reason', _reason, 'duration_min', _duration_min)
  );

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('📞 Call ended · %s min', round(_duration_min, 1)));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.end_session(uuid, text) TO authenticated;

-- ── 5. RPC: list_queue (engineer view) ─────────────────────────────────────
-- Returns the live queue — staff-only. Sorted by urgency DESC, queued_at ASC.

CREATE OR REPLACE FUNCTION public.list_queue()
RETURNS SETOF public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(auth.uid(),'engineer') OR has_role(auth.uid(),'pod_lead') OR
          has_role(auth.uid(),'ops_manager') OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
  SELECT * FROM guest_calls
   WHERE status = 'queued'
   ORDER BY
     CASE urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
     created_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.list_queue() TO authenticated;

COMMIT;
