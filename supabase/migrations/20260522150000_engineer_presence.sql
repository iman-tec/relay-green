-- ============================================================================
-- Engineer presence: explicit online/offline toggle + session logging
-- (master-prompt §3)
-- ============================================================================
-- The matcher already gates on engineer_profiles.is_available — that flag is
-- the engineer's "online / receiving calls" switch. Until now it was only
-- ever set to true at onboarding and never toggled, and there was no audit of
-- when an engineer went on/offline. This migration adds:
--
--   engineer_sessions        login_time / logout_time per online stint
--   engineer_status_changes   one row per toggle (timestamp + new state)
--   engineer_set_online(bool) flips is_available, writes the audit row, and
--                             opens/closes the engineer_sessions stint
--
-- "Online" = engineer_profiles.is_available = true. Going online opens an
-- engineer_sessions row (login); going offline closes it (logout).
-- ============================================================================

BEGIN;

-- ── engineer_sessions: one row per online stint ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.engineer_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login_time   timestamptz NOT NULL DEFAULT now(),
  logout_time  timestamptz,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','logged_out'))
);

-- At most one active stint per engineer.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_engineer_sessions_active
  ON public.engineer_sessions (engineer_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_engineer_sessions_engineer
  ON public.engineer_sessions (engineer_id, login_time DESC);

ALTER TABLE public.engineer_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Engineer reads own sessions" ON public.engineer_sessions;
CREATE POLICY "Engineer reads own sessions" ON public.engineer_sessions
  FOR SELECT TO authenticated
  USING (engineer_id = auth.uid());

DROP POLICY IF EXISTS "Staff read engineer sessions" ON public.engineer_sessions;
CREATE POLICY "Staff read engineer sessions" ON public.engineer_sessions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── engineer_status_changes: audit of every toggle ──────────────────────────
CREATE TABLE IF NOT EXISTS public.engineer_status_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online    boolean NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineer_status_changes_engineer
  ON public.engineer_status_changes (engineer_id, changed_at DESC);

ALTER TABLE public.engineer_status_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Engineer reads own status changes" ON public.engineer_status_changes;
CREATE POLICY "Engineer reads own status changes" ON public.engineer_status_changes
  FOR SELECT TO authenticated
  USING (engineer_id = auth.uid());

DROP POLICY IF EXISTS "Staff read status changes" ON public.engineer_status_changes;
CREATE POLICY "Staff read status changes" ON public.engineer_status_changes
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── RPC: engineer_set_online ────────────────────────────────────────────────
-- Single entry point for the dashboard toggle. Flips is_available, records the
-- status change, and opens/closes the engineer_sessions stint. Idempotent —
-- toggling to the same state just re-stamps the audit without duplicating an
-- active stint (the unique index makes a duplicate INSERT a no-op via ON
-- CONFLICT).
CREATE OR REPLACE FUNCTION public.engineer_set_online(_online boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me      uuid := auth.uid();
  _updated int;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;

  UPDATE engineer_profiles
     SET is_available = _online, updated_at = now()
   WHERE user_id = _me;
  GET DIAGNOSTICS _updated = ROW_COUNT;
  IF _updated = 0 THEN
    RAISE EXCEPTION 'NO_ENGINEER_PROFILE' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_status_changes (engineer_id, is_online)
  VALUES (_me, _online);

  IF _online THEN
    -- Open a stint if one isn't already active (unique index guards races).
    INSERT INTO engineer_sessions (engineer_id, status)
    VALUES (_me, 'active')
    ON CONFLICT (engineer_id) WHERE status = 'active' DO NOTHING;
  ELSE
    -- Close the active stint.
    UPDATE engineer_sessions
       SET logout_time = now(), status = 'logged_out'
     WHERE engineer_id = _me AND status = 'active';
  END IF;

  RETURN _online;
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_set_online(boolean) TO authenticated;

COMMIT;
