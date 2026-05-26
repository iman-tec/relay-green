-- ============================================================================
-- Keep engineer_profiles.is_available and presence_state in lockstep
-- ============================================================================
-- The new triple-state picker (20260527100000_engineer_presence_state) writes
-- both columns atomically via set_engineer_presence(). But the legacy
-- engineer_set_online() and supervisor_set_engineer_online() RPCs only touch
-- is_available, and ad-hoc SQL fixes (e.g. cleanup scripts) can update one
-- without the other. The result: engineer says "I'm online" in the picker
-- (presence_state='online') but the matcher sees is_available=false and
-- never rings them — customer hits "no active engineer".
--
-- This BEFORE UPDATE trigger enforces the invariant from the design:
--
--   presence_state = 'online'  ↔  is_available = true
--   presence_state IN ('busy','offline')  ↔  is_available = false
--
-- If either column is being changed, the other is brought in line. Both
-- updated in the same statement → presence_state wins (it's the canonical
-- "engineer intent" column).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._sync_engineer_presence_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New row: just normalise — presence_state is the source of truth.
    NEW.is_available := (NEW.presence_state = 'online');
    RETURN NEW;
  END IF;

  -- UPDATE path. Decide which column the caller actually changed.
  IF NEW.presence_state IS DISTINCT FROM OLD.presence_state THEN
    -- presence_state is the canonical write — sync is_available to match.
    NEW.is_available := (NEW.presence_state = 'online');
  ELSIF NEW.is_available IS DISTINCT FROM OLD.is_available THEN
    -- Legacy is_available toggle (engineer_set_online / supervisor override).
    -- Map back onto the triple state. 'busy' stays as-is — the engineer's
    -- explicit "busy" intent shouldn't get clobbered by an is_available flip.
    IF NEW.is_available = true AND COALESCE(NEW.presence_state, 'offline') <> 'online' THEN
      NEW.presence_state := 'online';
    ELSIF NEW.is_available = false AND NEW.presence_state = 'online' THEN
      NEW.presence_state := 'offline';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS engineer_profiles_sync_presence ON public.engineer_profiles;
CREATE TRIGGER engineer_profiles_sync_presence
  BEFORE INSERT OR UPDATE OF presence_state, is_available
  ON public.engineer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public._sync_engineer_presence_columns();

-- Backfill any current drift in one go (idempotent — re-runs are no-ops).
UPDATE public.engineer_profiles
   SET is_available = (presence_state = 'online'),
       updated_at   = now()
 WHERE is_available <> (presence_state = 'online');

COMMIT;
