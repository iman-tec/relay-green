-- ============================================================================
-- Pod-scoped supervisor view (Bug #7)
-- ============================================================================
-- Each guest_call now carries a pod_id, copied from the engineer's pod
-- membership at claim time. The /supervise UI filters by this column so a
-- pod_lead / ops_manager only sees sessions owned by engineers on their pod.
-- super_admin and admin remain unscoped at the client layer.
--
-- pod_id is nullable: pre-Phase-1 sessions and sessions claimed by engineers
-- with no pod membership stay invisible to scoped supervisors, which is the
-- intended behavior (the engineer hasn't been organisationally assigned, so
-- no pod owns the session).
--
-- NOT included in this migration: a defensive RLS policy. The existing
-- "Public read guest_calls" USING (true) is required for anonymous /room
-- visitors to fetch their own session by id; tightening it is its own
-- (larger-blast-radius) change tracked separately. The UI filter is
-- bypassable from the browser console until that lands.
-- ============================================================================

BEGIN;

-- ── 1. Column ──────────────────────────────────────────────────────────────
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES public.pods(id) ON DELETE SET NULL;

-- ── 2. Backfill ────────────────────────────────────────────────────────────
-- Anything currently claimed gets the engineer's pod. Unclaimed (queued) or
-- engineer-without-pod rows stay NULL — they'll be picked up on the next
-- claim_session call.
UPDATE public.guest_calls gc
SET    pod_id = pm.pod_id
FROM   public.pod_members pm
WHERE  gc.claimed_by = pm.user_id
  AND  gc.pod_id IS NULL;

-- ── 3. Index ───────────────────────────────────────────────────────────────
-- Partial index covering the supervise query (active + queued statuses
-- ordered by created_at DESC). Past sessions don't need a pod index — the
-- past tab pulls a small window already filtered by ended_at.
CREATE INDEX IF NOT EXISTS idx_guest_calls_pod_active
  ON public.guest_calls (pod_id, created_at DESC)
  WHERE status IN ('queued','assigned','joining','live','grace','expired_free');

-- ── 4. claim_session: stamp pod_id ─────────────────────────────────────────
-- Same atomic claim as 20260510140000, but additionally writes pod_id from
-- the claiming engineer's pod_members row. NULL if they're not in a pod.
CREATE OR REPLACE FUNCTION public.claim_session(_session_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _s          public.guest_calls;
  _engineer   text;
  _staff      boolean;
  _pod        uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  _staff := has_role(auth.uid(),'engineer')
         OR has_role(auth.uid(),'pod_lead')
         OR has_role(auth.uid(),'ops_manager')
         OR has_role(auth.uid(),'admin');
  IF NOT _staff THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(NULLIF(full_name,''), 'Engineer') INTO _engineer
    FROM profiles WHERE id = auth.uid();

  -- One user is in at most one pod (UNIQUE constraint on pod_members.user_id).
  SELECT pod_id INTO _pod
    FROM pod_members
    WHERE user_id = auth.uid()
    LIMIT 1;

  UPDATE guest_calls SET
    status        = 'assigned',
    claimed_by    = auth.uid(),
    claimed_at    = now(),
    assigned_at   = now(),
    agent_name    = COALESCE(_engineer, 'Engineer'),
    pod_id        = _pod,
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
    jsonb_build_object(
      'engineer_id',   auth.uid(),
      'engineer_name', _engineer,
      'pod_id',        _pod
    )
  );

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session_id, 'system', 'Relay',
          format('👤 %s joined as engineer', COALESCE(_engineer, 'Engineer')));

  RETURN _s;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_session(uuid) TO authenticated;

COMMIT;
