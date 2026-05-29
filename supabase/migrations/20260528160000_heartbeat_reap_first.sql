-- ============================================================================
-- Heartbeat: reap-first ordering + presence-row init on go-online
-- ============================================================================
-- Bug observed after 20260528150000_reap_idle_engineers_offline landed:
--
--   1. Engineer clicks Online at t=0. Heartbeats fire at t=10, 20, ...
--   2. Engineer hits Win+L at t=60. Client gates the heartbeat on
--      document.hidden, so no more pings. engineer_presence row goes stale.
--   3. NO OTHER engineer is heartbeating and NO customer is matching, so
--      reap_idle_engineers() never gets called during the lock period.
--   4. Engineer unlocks at t=120. visibilitychange fires → ping() resumes.
--   5. engineer_heartbeat() upserts the presence row FIRST (refreshing
--      last_seen_at to now()), then calls reap_idle_engineers(). The
--      reaper now sees zero stale rows because the caller just refreshed.
--      → engineer is never flipped offline. Ball stays green.
--
-- Two changes fix this:
--
-- A. engineer_heartbeat() runs the reaper BEFORE the upsert. When the
--    engineer returns from a lock/sleep, the reaper sees their OWN stale
--    presence row (last ping was >30s ago) and flips them offline. The
--    subsequent upsert refreshes last_seen_at but does NOT undo the
--    offline flip — the flip is on engineer_profiles, the upsert is on
--    engineer_presence, two different tables. The engineer must click
--    Online again to come back, matching the demote-only model.
--
-- B. set_engineer_presence('online') now seeds a fresh engineer_presence
--    row in the same transaction. Without this, a brand-new session
--    (engineer toggled online, but their tab hasn't sent the first
--    heartbeat yet) would have presence_state='online' and NO row in
--    engineer_presence — the reaper's LEFT JOIN treats that as stale and
--    would false-positive-flip them offline on the first heartbeat after
--    the reorder. Seeding the row at go-online time means the first
--    heartbeat finds a fresh row (0s old) and skips them correctly.
-- ============================================================================

BEGIN;

-- ── A. engineer_heartbeat: reap-first ──────────────────────────────────────
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

  -- Reap first — if the caller's own presence row is >30s old, this flips
  -- THEM to offline before the upsert refreshes their last_seen_at. That
  -- way "come back from lunch / unlock screen" correctly resolves to grey
  -- instead of silently re-greening because the upsert masked the stale
  -- state. Also reaps any other engineers whose tabs have gone silent.
  PERFORM public.reap_idle_engineers();

  INSERT INTO public.engineer_presence (engineer_id, last_seen_at, focused)
  VALUES (_me, now(), COALESCE(_focused, true))
  ON CONFLICT (engineer_id) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at,
        focused      = EXCLUDED.focused,
        updated_at   = now();

  RETURN now();
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_heartbeat(boolean) TO authenticated;

-- ── B. set_engineer_presence: seed presence row on go-online ───────────────
-- Re-defines the function from 20260528130000_match_engineer_inline_reap
-- with one addition: when transitioning to 'online', upsert a fresh row in
-- engineer_presence so the reaper's first sweep finds last_seen_at=now()
-- instead of NULL. Everything else (the guest_calls self-heal, audit row,
-- session stint open/close) is preserved verbatim.
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

  -- Self-heal: when the engineer says "I'm online again", clean up any
  -- ghost-call rows for THIS engineer that the auto-busy watcher would
  -- otherwise use to re-flip her to busy. (Preserved from 20260528130000.)
  IF _state = 'online' THEN
    UPDATE public.guest_calls AS gc
       SET status = 'abandoned',
           updated_at = now()
     WHERE gc.claimed_by = _me
       AND gc.status IN ('assigned', 'joining')
       AND gc.assigned_at < now() - interval '60 seconds'
       AND (
         gc.joined_at IS NULL
         OR NOT EXISTS (
           SELECT 1
             FROM public.engineer_presence p
            WHERE p.engineer_id = _me
              AND p.last_seen_at > now() - interval '60 seconds'
         )
       );

    -- NEW: seed a fresh engineer_presence row so the reaper doesn't see
    -- a NULL last_seen_at and false-positive-flip this engineer offline
    -- on their first heartbeat after going online.
    INSERT INTO public.engineer_presence (engineer_id, last_seen_at, focused)
    VALUES (_me, now(), true)
    ON CONFLICT (engineer_id) DO UPDATE
      SET last_seen_at = now(),
          focused      = true,
          updated_at   = now();
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
