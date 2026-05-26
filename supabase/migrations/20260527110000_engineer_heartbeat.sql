-- ============================================================================
-- Engineer presence heartbeat — table + RPC
-- ============================================================================
-- `engineer_profiles.is_available` is sticky: it only flips when the engineer
-- toggles the switch (or a supervisor does it via 20260525200000). That misses
-- the most common failure mode for ring pickup — the engineer left the tab
-- open and walked away, so we ring a ghost.
--
-- This adds a real heartbeat the matcher can lean on without ever flipping
-- is_available on its own:
--
--   engineer_presence(engineer_id, last_seen_at, focused)
--   RPC engineer_heartbeat(_focused boolean)
--
-- Client pings every 10 s (also on visibilitychange + beforeunload). The
-- matcher in 20260527120000 will treat an engineer as "hot" when
--   last_seen_at > now() - interval '30 seconds' AND focused
-- and use that to fan out parallel offers when several hot candidates tie.
--
-- Engineer-only. supervisor_set_engineer_online (20260525200000) stays the
-- mechanism for actually marking someone offline; this just observes.
-- ============================================================================

BEGIN;

-- ── engineer_presence ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engineer_presence (
  engineer_id  uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  focused      boolean     NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineer_presence_last_seen
  ON public.engineer_presence (last_seen_at DESC);

ALTER TABLE public.engineer_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Engineer reads own presence" ON public.engineer_presence;
CREATE POLICY "Engineer reads own presence" ON public.engineer_presence
  FOR SELECT TO authenticated
  USING (engineer_id = auth.uid());

DROP POLICY IF EXISTS "Staff read engineer presence" ON public.engineer_presence;
CREATE POLICY "Staff read engineer presence" ON public.engineer_presence
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager') OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );

-- ── RPC: engineer_heartbeat ────────────────────────────────────────────────
-- Client pings every 10 s with `document.hasFocus()`. Upsert keyed on
-- auth.uid(); SECURITY DEFINER so the RLS write-side isn't needed.
CREATE OR REPLACE FUNCTION public.engineer_heartbeat(_focused boolean)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;

  INSERT INTO engineer_presence (engineer_id, last_seen_at, focused)
  VALUES (_me, now(), COALESCE(_focused, true))
  ON CONFLICT (engineer_id) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at,
        focused      = EXCLUDED.focused,
        updated_at   = now();

  RETURN now();
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_heartbeat(boolean) TO authenticated;

COMMIT;
