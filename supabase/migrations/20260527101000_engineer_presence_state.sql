-- ============================================================================
-- Engineer presence: triple-state (online / busy / offline)
-- ============================================================================
-- The previous migration (20260522150000_engineer_presence.sql) tracked the
-- binary online/offline toggle on engineer_profiles.is_available. That flag
-- is still the matcher's gate (true = matcher rings them; false = silent),
-- but the customer-side picker now also distinguishes "busy" from "offline":
--
--   online    → matcher rings, instant-call affordance in the picker
--   busy      → matcher skips them, but customer can "Request to connect"
--               (lands in engineer's inbox as a connect-request)
--   offline   → matcher skips them, customer can "Schedule" via calendar
--
-- engineer_profiles.is_available stays the source of truth for the matcher.
-- presence_state is the engineer's intent, surfaced to the customer.
--
-- Backfill: existing engineers whose is_available was true → 'online',
-- everyone else → 'offline'. Future toggles flip both columns atomically
-- via set_engineer_presence.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_profiles
  ADD COLUMN IF NOT EXISTS presence_state text NOT NULL DEFAULT 'offline';

ALTER TABLE public.engineer_profiles
  DROP CONSTRAINT IF EXISTS engineer_profiles_presence_state_check;
ALTER TABLE public.engineer_profiles
  ADD CONSTRAINT engineer_profiles_presence_state_check
  CHECK (presence_state IN ('online', 'busy', 'offline'));

-- Backfill: anyone currently marked available is online, everyone else offline.
UPDATE public.engineer_profiles
  SET presence_state = CASE WHEN is_available THEN 'online' ELSE 'offline' END
  WHERE presence_state = 'offline' AND is_available IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engineer_profiles_presence_state
  ON public.engineer_profiles (presence_state);

-- ── RPC: set_engineer_presence ────────────────────────────────────────────
-- Single entry-point for the new triple-state picker. Maps the new states
-- onto the existing is_available + engineer_sessions infrastructure so the
-- matcher and audit log stay coherent.
--
--   'online'  → presence_state='online',  is_available=true   (opens stint)
--   'busy'    → presence_state='busy',    is_available=false  (closes stint)
--   'offline' → presence_state='offline', is_available=false  (closes stint)
--
-- Why is_available falls to false for busy: the matcher's ring queue must
-- skip busy engineers — they explicitly said "don't auto-ring me, surface
-- requests instead." The customer-facing picker reads presence_state, not
-- is_available, so it can show the busy state distinctly.
CREATE OR REPLACE FUNCTION public.set_engineer_presence(_state text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _me      uuid := auth.uid();
  _updated int;
  _avail   boolean;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_me, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;
  IF _state NOT IN ('online', 'busy', 'offline') THEN
    RAISE EXCEPTION 'INVALID_PRESENCE_STATE' USING ERRCODE='P0001';
  END IF;

  _avail := (_state = 'online');

  UPDATE engineer_profiles
     SET presence_state = _state,
         is_available  = _avail,
         updated_at    = now()
   WHERE user_id = _me;
  GET DIAGNOSTICS _updated = ROW_COUNT;
  IF _updated = 0 THEN
    RAISE EXCEPTION 'NO_ENGINEER_PROFILE' USING ERRCODE='P0001';
  END IF;

  -- Mirror the change into engineer_status_changes + engineer_sessions so
  -- existing audit + stint tracking stays accurate. Only flip the stint
  -- when crossing the online boundary (busy/offline both keep it closed).
  INSERT INTO engineer_status_changes (engineer_id, is_online)
  VALUES (_me, _avail);

  IF _avail THEN
    INSERT INTO engineer_sessions (engineer_id, status)
    VALUES (_me, 'active')
    ON CONFLICT (engineer_id) WHERE status = 'active' DO NOTHING;
  ELSE
    UPDATE engineer_sessions
       SET logout_time = now(), status = 'logged_out'
     WHERE engineer_id = _me AND status = 'active';
  END IF;

  RETURN _state;
END $$;

GRANT EXECUTE ON FUNCTION public.set_engineer_presence(text) TO authenticated;

COMMIT;
