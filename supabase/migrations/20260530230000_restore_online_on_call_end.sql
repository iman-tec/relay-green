-- ============================================================================
-- Restore the engineer to ONLINE when their call ends — for BOTH end paths.
-- ============================================================================
-- An engineer goes 'busy' (engineer_profiles.presence_state='busy',
-- is_available=false) while on a call, so the matcher skips them. When the call
-- ends they should flip back to 'online' (is_available=true) so the matcher can
-- ring them again.
--
-- Today that restore is done CLIENT-SIDE by the EngineerPresenceBall auto-
-- watcher (busy → online when its guest_calls subscription sees the call go
-- terminal). It works when the CUSTOMER ends the call — the engineer's page
-- stays mounted, the realtime event arrives, the watcher restores online. But
-- when the ENGINEER ends the call, EngineerSessionClient immediately navigates
-- to /inbox, unmounting the watcher before the event/recompute runs — so the
-- restore is lost and the engineer is stranded 'busy'.
--
-- Fix: do the restore SERVER-SIDE, in the trigger that already fires for both
-- end paths (refresh_engineer_presence_on_call_end). When a claimed call goes
-- terminal, flip the engineer busy → online (presence_state + is_available),
-- mirroring set_engineer_presence's 'online' branch into the audit log + stint
-- so billing/analytics stay coherent. Only 'busy' is restored — a manual
-- 'offline' is left untouched. This makes the restore symmetric and race-free,
-- independent of which client is mounted. Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_engineer_presence_on_call_end()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _restored int;
BEGIN
  IF NEW.status IN ('cancelled', 'ended', 'abandoned')
     AND OLD.status NOT IN ('cancelled', 'ended', 'abandoned')
     AND NEW.claimed_by IS NOT NULL
  THEN
    -- Refresh the engineer's heartbeat row so the cron reaper, on its next
    -- tick, sees a fresh last_seen_at and doesn't reap them just because the
    -- active-call exclusion lifted at the same instant.
    INSERT INTO public.engineer_presence (engineer_id, last_seen_at, focused)
    VALUES (NEW.claimed_by, now(), true)
    ON CONFLICT (engineer_id) DO UPDATE
      SET last_seen_at = now(),
          focused      = true,
          updated_at   = now();

    -- Restore busy → online so the matcher can ring them again. Fires for both
    -- end paths (customer- or engineer-initiated). Manual 'offline' is left as
    -- is. Scoped to presence_state='busy' so we only undo the on-call busy.
    UPDATE public.engineer_profiles
       SET presence_state = 'online',
           is_available   = true,
           updated_at     = now()
     WHERE user_id = NEW.claimed_by
       AND presence_state = 'busy';
    GET DIAGNOSTICS _restored = ROW_COUNT;

    -- Mirror into the audit log + stint exactly like set_engineer_presence's
    -- 'online' branch, but only if we actually flipped them.
    IF _restored > 0 THEN
      INSERT INTO public.engineer_status_changes (engineer_id, is_online)
      VALUES (NEW.claimed_by, true);

      INSERT INTO public.engineer_sessions (engineer_id, status)
      VALUES (NEW.claimed_by, 'active')
      ON CONFLICT (engineer_id) WHERE status = 'active' DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Trigger binding (refresh_engineer_presence_on_call_end_trg, AFTER UPDATE OF
-- status ON guest_calls) already exists from 20260529100000 and points at this
-- function by name. Not recreated here.

COMMIT;
