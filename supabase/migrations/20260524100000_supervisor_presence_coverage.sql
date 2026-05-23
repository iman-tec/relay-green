-- ============================================================================
-- Supervisor presence + automatic coverage failover
-- ============================================================================
-- Problem (manual-test bug): a customer connected to an engineer in pod1 has
-- NO supervisor watching when pod1's supervisor is offline — even if another
-- pod's supervisor is online. We must never leave a live session unsupervised.
--
-- This migration mirrors the engineer-presence model (20260522150000) for
-- supervisors and adds an explicit "covering supervisor" pointer on every
-- session:
--
--   supervisor_presence        is_online flag (the explicit on-duty toggle)
--   supervisor_sessions         login/logout stints (audit)
--   supervisor_status_changes   one row per toggle (audit)
--   supervisor_set_online(bool) flips presence, logs it, and RE-BALANCES
--                               coverage (sweeps orphans on, re-routes on off)
--   guest_calls.supervisor_user_id   the supervisor currently covering this
--                               session (chosen automatically)
--   pick_supervisor_for_session(pod, exclude)  pure picker:
--       • the pod's own supervisor when they are online
--       • else the least-loaded ONLINE supervisor/super_admin (any pod)
--       • else NULL (nobody online — unavoidable; swept up later)
--   trg_assign_session_supervisor   BEFORE INSERT/UPDATE OF status,pod_id —
--       stamps supervisor_user_id at claim time and re-picks whenever the
--       current cover is gone/offline.
--
-- Re-routing ("if the covering supervisor also goes offline") is handled by
-- supervisor_set_online(false), which reassigns that supervisor's active
-- sessions to whoever is still online.
--
-- guest_calls SELECT is already `USING (true)` and can_access_chat_session
-- grants supervisor-tier full read, so a cross-pod failover supervisor can
-- already see + open the session — no RLS change is needed here. The pod
-- scoping lives only in the client query (SuperviseClient), which now matches
-- on supervisor_user_id.
-- ============================================================================

BEGIN;

-- Coverage applies only while a session is live-ish. Queued sessions have no
-- pod/engineer yet, and terminal states need no supervisor.
--   ('assigned','joining','live','grace','ending','expired_free')

-- ── supervisor_presence: the explicit on-duty flag ──────────────────────────
CREATE TABLE IF NOT EXISTS public.supervisor_presence (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online  boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supervisor_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisor reads own presence" ON public.supervisor_presence;
CREATE POLICY "Supervisor reads own presence" ON public.supervisor_presence
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read supervisor presence" ON public.supervisor_presence;
CREATE POLICY "Staff read supervisor presence" ON public.supervisor_presence
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── supervisor_sessions: one row per online stint ───────────────────────────
CREATE TABLE IF NOT EXISTS public.supervisor_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login_time    timestamptz NOT NULL DEFAULT now(),
  logout_time   timestamptz,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','logged_out'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_supervisor_sessions_active
  ON public.supervisor_sessions (supervisor_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_supervisor_sessions_supervisor
  ON public.supervisor_sessions (supervisor_id, login_time DESC);

ALTER TABLE public.supervisor_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisor reads own sessions" ON public.supervisor_sessions;
CREATE POLICY "Supervisor reads own sessions" ON public.supervisor_sessions
  FOR SELECT TO authenticated
  USING (supervisor_id = auth.uid());

DROP POLICY IF EXISTS "Staff read supervisor sessions" ON public.supervisor_sessions;
CREATE POLICY "Staff read supervisor sessions" ON public.supervisor_sessions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── supervisor_status_changes: audit of every toggle ────────────────────────
CREATE TABLE IF NOT EXISTS public.supervisor_status_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online     boolean NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_status_changes_supervisor
  ON public.supervisor_status_changes (supervisor_id, changed_at DESC);

ALTER TABLE public.supervisor_status_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Supervisor reads own status changes" ON public.supervisor_status_changes;
CREATE POLICY "Supervisor reads own status changes" ON public.supervisor_status_changes
  FOR SELECT TO authenticated
  USING (supervisor_id = auth.uid());

DROP POLICY IF EXISTS "Staff read supervisor status changes" ON public.supervisor_status_changes;
CREATE POLICY "Staff read supervisor status changes" ON public.supervisor_status_changes
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── guest_calls.supervisor_user_id: the covering supervisor ──────────────────
ALTER TABLE public.guest_calls
  ADD COLUMN IF NOT EXISTS supervisor_user_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_calls_supervisor
  ON public.guest_calls (supervisor_user_id)
  WHERE supervisor_user_id IS NOT NULL;

-- ── helper: is this supervisor on duty? ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._supervisor_is_online(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _uid IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM supervisor_presence sp
        WHERE sp.user_id = _uid AND sp.is_online = true
     );
$$;

-- ── helper: pick the covering supervisor for a session ──────────────────────
-- Pure read (no writes) so it's safe to call from a BEFORE trigger and from
-- the re-balance UPDATEs without recursion. Returns NULL when no eligible
-- supervisor is online — the session is left uncovered until one comes online.
CREATE OR REPLACE FUNCTION public.pick_supervisor_for_session(
  _pod uuid,
  _exclude_session uuid
)
RETURNS uuid
-- VOLATILE: reads live presence/load and uses random() for tie-breaking, so it
-- must be re-evaluated per row in the rebalance UPDATEs (not cached).
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _pod_sup uuid;
  _chosen  uuid;
BEGIN
  -- 1. Prefer the pod's own supervisor when they are online.
  IF _pod IS NOT NULL THEN
    SELECT pm.user_id INTO _pod_sup
      FROM pod_members pm
     WHERE pm.pod_id = _pod AND pm.pod_role = 'supervisor'
     LIMIT 1;
    IF _pod_sup IS NOT NULL AND public._supervisor_is_online(_pod_sup) THEN
      RETURN _pod_sup;
    END IF;
  END IF;

  -- 2. Else the least-loaded ONLINE supervisor / super_admin, any pod.
  SELECT sp.user_id INTO _chosen
    FROM supervisor_presence sp
   WHERE sp.is_online = true
     AND (has_role(sp.user_id, 'supervisor') OR has_role(sp.user_id, 'super_admin'))
   ORDER BY (
     SELECT count(*) FROM guest_calls gc
      WHERE gc.supervisor_user_id = sp.user_id
        AND gc.status IN ('assigned','joining','live','grace','ending','expired_free')
        AND (_exclude_session IS NULL OR gc.id <> _exclude_session)
   ) ASC, random()
   LIMIT 1;

  RETURN _chosen;  -- may be NULL when nobody is online
END $$;

-- ── trigger: stamp / re-pick the covering supervisor ────────────────────────
-- Fires only when status or pod_id changes (i.e. at claim and lifecycle
-- transitions). Sets NEW.supervisor_user_id directly (BEFORE trigger), so it
-- never recurses. Re-picks when the current cover is empty or has gone
-- offline.
CREATE OR REPLACE FUNCTION public._assign_session_supervisor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('assigned','joining','live','grace','ending','expired_free') THEN
    IF NEW.supervisor_user_id IS NULL
       OR NOT public._supervisor_is_online(NEW.supervisor_user_id) THEN
      NEW.supervisor_user_id := public.pick_supervisor_for_session(NEW.pod_id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_session_supervisor ON public.guest_calls;
CREATE TRIGGER trg_assign_session_supervisor
  BEFORE INSERT OR UPDATE OF status, pod_id ON public.guest_calls
  FOR EACH ROW EXECUTE FUNCTION public._assign_session_supervisor();

-- ── RPC: supervisor_set_online ──────────────────────────────────────────────
-- The explicit on-duty toggle (mirrors engineer_set_online). Going OFFLINE
-- re-routes the supervisor's covered sessions to whoever is still online;
-- going ONLINE sweeps up any currently-uncovered active sessions.
CREATE OR REPLACE FUNCTION public.supervisor_set_online(_online boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(_me, 'supervisor') OR has_role(_me, 'super_admin')) THEN
    RAISE EXCEPTION 'NOT_A_SUPERVISOR' USING ERRCODE='P0001';
  END IF;

  INSERT INTO supervisor_presence (user_id, is_online, updated_at)
  VALUES (_me, _online, now())
  ON CONFLICT (user_id) DO UPDATE
    SET is_online = EXCLUDED.is_online, updated_at = now();

  INSERT INTO supervisor_status_changes (supervisor_id, is_online)
  VALUES (_me, _online);

  IF _online THEN
    INSERT INTO supervisor_sessions (supervisor_id, status)
    VALUES (_me, 'active')
    ON CONFLICT (supervisor_id) WHERE status = 'active' DO NOTHING;

    -- Sweep up any currently-uncovered live sessions now that someone is on.
    UPDATE guest_calls gc
       SET supervisor_user_id = public.pick_supervisor_for_session(gc.pod_id, gc.id),
           updated_at = now()
     WHERE gc.supervisor_user_id IS NULL
       AND gc.status IN ('assigned','joining','live','grace','ending','expired_free');
  ELSE
    UPDATE supervisor_sessions
       SET logout_time = now(), status = 'logged_out'
     WHERE supervisor_id = _me AND status = 'active';

    -- Re-route everything this supervisor was covering to whoever is left.
    UPDATE guest_calls gc
       SET supervisor_user_id = public.pick_supervisor_for_session(gc.pod_id, gc.id),
           updated_at = now()
     WHERE gc.supervisor_user_id = _me
       AND gc.status IN ('assigned','joining','live','grace','ending','expired_free');
  END IF;

  RETURN _online;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_set_online(boolean) TO authenticated;

-- ── Backfill: stamp coverage on any already-live sessions ───────────────────
-- (Picks NULL until a supervisor toggles online, which then sweeps them up.)
UPDATE guest_calls gc
   SET supervisor_user_id = public.pick_supervisor_for_session(gc.pod_id, gc.id)
 WHERE gc.supervisor_user_id IS NULL
   AND gc.status IN ('assigned','joining','live','grace','ending','expired_free');

COMMIT;
