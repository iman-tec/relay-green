-- ============================================================================
-- Backend-driven auto-offline for idle engineers
-- ============================================================================
-- The client (lib/relay/useEngineerHeartbeat.ts) pings engineer_heartbeat()
-- every 10s while a staff route is mounted. If 3 consecutive pings are missed
-- (~30s of silence), it almost certainly means the engineer's tab is closed,
-- the browser crashed, the laptop slept, or the network died — i.e. they're
-- not actually reachable. Until now nothing on the server side acted on that
-- silence, so engineer_profiles.is_available stayed true forever and the
-- matcher would still ring a ghost.
--
-- This migration closes the loop:
--
--   public.reap_idle_engineers()
--     • Flips every engineer with presence_state IN ('online','busy') whose
--       engineer_presence.last_seen_at is older than 30s (or has no presence
--       row at all) to presence_state='offline', is_available=false.
--     • Mirrors the same side-effects set_engineer_presence does:
--         - engineer_status_changes audit row (is_online=false)
--         - close any active engineer_sessions stint (logout_time=now())
--     • Returns the number of engineers reaped.
--
-- It runs automatically at two natural choke points, so no external scheduler
-- (pg_cron, edge function) is required:
--
--   A. engineer_heartbeat()  → every active engineer's 10s ping reaps OTHER
--      idle engineers. As long as at least one engineer is heartbeating, a
--      tab that went silent is detected within ~10s of crossing the 30s mark.
--
--   B. match_engineer()  → defensive top-of-function reap. Covers the case
--      where every engineer's tab has died at once — the next customer match
--      attempt self-heals stale presence before scoring candidates.
--
-- The engineer's own dashboard picks up the flip via the existing realtime
-- subscription on engineer_profiles in app/_components/EngineerPresenceBall.tsx,
-- so the presence ball turns grey and the matcher-rings-me copy disappears
-- without any extra client wiring.
-- ============================================================================

BEGIN;

-- ── reaper ─────────────────────────────────────────────────────────────────
-- Targets engineers currently presented as online or busy whose heartbeat
-- has gone silent for >30s (or who never heartbeated at all). The same row
-- can't be reaped twice in quick succession because after the first flip
-- presence_state='offline' fails the WHERE clause.
CREATE OR REPLACE FUNCTION public.reap_idle_engineers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _reaped uuid[];
  _count  int;
BEGIN
  WITH stale AS (
    SELECT ep.user_id
      FROM public.engineer_profiles ep
      LEFT JOIN public.engineer_presence pres ON pres.engineer_id = ep.user_id
     WHERE ep.presence_state IN ('online', 'busy')
       AND (
         pres.last_seen_at IS NULL
         OR pres.last_seen_at < now() - interval '30 seconds'
       )
  ),
  flipped AS (
    UPDATE public.engineer_profiles ep
       SET presence_state = 'offline',
           is_available   = false,
           updated_at     = now()
      FROM stale
     WHERE ep.user_id = stale.user_id
     RETURNING ep.user_id
  )
  SELECT array_agg(user_id) INTO _reaped FROM flipped;

  _count := COALESCE(array_length(_reaped, 1), 0);
  IF _count = 0 THEN
    RETURN 0;
  END IF;

  -- Audit row per reaped engineer.
  INSERT INTO public.engineer_status_changes (engineer_id, is_online)
  SELECT unnest(_reaped), false;

  -- Close the active stint for each reaped engineer (if one was open).
  UPDATE public.engineer_sessions
     SET logout_time = now(), status = 'logged_out'
   WHERE engineer_id = ANY (_reaped)
     AND status = 'active';

  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.reap_idle_engineers() TO authenticated;

-- ── engineer_heartbeat: stamp self then reap others ────────────────────────
-- Same signature/behavior as 20260528020000; the only addition is the
-- PERFORM reap_idle_engineers() at the end. The caller is safe from being
-- reaped because their last_seen_at was just stamped to now() above.
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

  INSERT INTO public.engineer_presence (engineer_id, last_seen_at, focused)
  VALUES (_me, now(), COALESCE(_focused, true))
  ON CONFLICT (engineer_id) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at,
        focused      = EXCLUDED.focused,
        updated_at   = now();

  -- Side-effect: any other engineer whose heartbeat has gone silent for
  -- >30s gets flipped offline as part of this transaction. Bounded UPDATE,
  -- cheap, idempotent — safe to fire from every 10s ping.
  PERFORM public.reap_idle_engineers();

  RETURN now();
END $$;

GRANT EXECUTE ON FUNCTION public.engineer_heartbeat(boolean) TO authenticated;

-- ── match_engineer: reap idle presence at top of every match attempt ───────
-- Mirrors the pattern from 20260528130000 (reap_stale_assigned_sessions).
-- We re-define the whole body so this migration is self-contained and
-- doesn't depend on call-order between the two reapers. Both PERFORMs run
-- before scoring, so the candidate pool reflects post-reap reality.
CREATE OR REPLACE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake          public.client_intakes;
  _top_hot_score   numeric;
  _hot_within_band int;
  _offer           public.engineer_match_offers;
  _candidates      uuid[];
  _scores          numeric[];
  _idx             int;
  _rec             record;
BEGIN
  PERFORM public.reap_idle_engineers();
  PERFORM public.reap_stale_assigned_sessions();

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  WITH scored AS (
    SELECT
      ur.user_id,
      3.0 * cardinality(ARRAY(SELECT unnest(ep.technologies) INTERSECT SELECT unnest(COALESCE(_intake.technologies, '{}'::text[]))))::numeric
      + 2.0 * cardinality(ARRAY(SELECT unnest(ep.issues)       INTERSECT SELECT unnest(COALESCE(_intake.issues,       '{}'::text[]))))::numeric
      + 1.0 * cardinality(ARRAY(SELECT unnest(ep.environments) INTERSECT SELECT unnest(COALESCE(_intake.environments, '{}'::text[]))))::numeric
      + CASE
          WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Experienced'  THEN 1.5
          WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Intermediate' THEN 1.0
          WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Experienced'  THEN 1.0
          WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Intermediate' THEN 0.75
          WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Intermediate' THEN 1.0
          WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Experienced'  THEN 0.75
          ELSE 0.5
        END AS score,
      (pres.last_seen_at > now() - interval '30 seconds' AND COALESCE(pres.focused, false)) AS is_hot
    FROM user_role_names ur
    LEFT JOIN engineer_profiles ep   ON ep.user_id     = ur.user_id
    LEFT JOIN engineer_presence pres ON pres.engineer_id = ur.user_id
    WHERE ur.role = 'engineer'
      AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(ep.is_available, true)
      AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
      AND NOT EXISTS (
        SELECT 1 FROM guest_calls gc
         WHERE gc.claimed_by = ur.user_id
           AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM engineer_match_offers o
         WHERE o.intake_id       = _intake.id
           AND o.guest_call_id   = _intake.guest_call_id
           AND o.engineer_user_id = ur.user_id
      )
  ),
  top_hot AS (SELECT MAX(score) AS s FROM scored WHERE is_hot)
  SELECT
    (SELECT s FROM top_hot),
    (SELECT COUNT(*)::int FROM scored s, top_hot t WHERE s.is_hot AND t.s IS NOT NULL AND s.score >= t.s - 2.0)
   INTO _top_hot_score, _hot_within_band;

  IF _top_hot_score IS NOT NULL AND _hot_within_band >= 2 THEN
    WITH scored AS (
      SELECT
        ur.user_id,
        3.0 * cardinality(ARRAY(SELECT unnest(ep.technologies) INTERSECT SELECT unnest(COALESCE(_intake.technologies, '{}'::text[]))))::numeric
        + 2.0 * cardinality(ARRAY(SELECT unnest(ep.issues)       INTERSECT SELECT unnest(COALESCE(_intake.issues,       '{}'::text[]))))::numeric
        + 1.0 * cardinality(ARRAY(SELECT unnest(ep.environments) INTERSECT SELECT unnest(COALESCE(_intake.environments, '{}'::text[]))))::numeric
        + CASE
            WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Experienced'  THEN 1.5
            WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Intermediate' THEN 1.0
            WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Experienced'  THEN 1.0
            WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Intermediate' THEN 0.75
            WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Intermediate' THEN 1.0
            WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Experienced'  THEN 0.75
            ELSE 0.5
          END AS score,
        (pres.last_seen_at > now() - interval '30 seconds' AND COALESCE(pres.focused, false)) AS is_hot
      FROM user_role_names ur
      LEFT JOIN engineer_profiles ep   ON ep.user_id     = ur.user_id
      LEFT JOIN engineer_presence pres ON pres.engineer_id = ur.user_id
      WHERE ur.role = 'engineer'
        AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND COALESCE(ep.is_available, true)
        AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM guest_calls gc
           WHERE gc.claimed_by = ur.user_id
             AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
        )
        AND NOT EXISTS (
          SELECT 1 FROM engineer_match_offers o
           WHERE o.intake_id       = _intake.id
             AND o.guest_call_id   = _intake.guest_call_id
             AND o.engineer_user_id = ur.user_id
        )
    ),
    top_hot AS (SELECT MAX(score) AS s FROM scored WHERE is_hot),
    chosen AS (
      SELECT s.user_id, s.score
        FROM scored s, top_hot t
       WHERE s.is_hot AND t.s IS NOT NULL AND s.score >= t.s - 2.0
       ORDER BY s.score DESC, random()
       FETCH FIRST 3 ROWS ONLY
    )
    SELECT array_agg(user_id), array_agg(score)
      INTO _candidates, _scores
      FROM chosen;

    IF _candidates IS NULL OR array_length(_candidates, 1) IS NULL THEN
      RETURN;
    END IF;

    FOR _idx IN 1 .. array_length(_candidates, 1) LOOP
      INSERT INTO engineer_match_offers (
        intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
      ) VALUES (
        _intake.id, _intake.guest_call_id, _candidates[_idx], _intake.customer_user_id, _scores[_idx]
      )
      RETURNING * INTO _offer;
      RETURN NEXT _offer;
    END LOOP;
    RETURN;
  END IF;

  WITH scored AS (
    SELECT
      ur.user_id,
      3.0 * cardinality(ARRAY(SELECT unnest(ep.technologies) INTERSECT SELECT unnest(COALESCE(_intake.technologies, '{}'::text[]))))::numeric
      + 2.0 * cardinality(ARRAY(SELECT unnest(ep.issues)       INTERSECT SELECT unnest(COALESCE(_intake.issues,       '{}'::text[]))))::numeric
      + 1.0 * cardinality(ARRAY(SELECT unnest(ep.environments) INTERSECT SELECT unnest(COALESCE(_intake.environments, '{}'::text[]))))::numeric
      + CASE
          WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Experienced'  THEN 1.5
          WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Intermediate' THEN 1.0
          WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Experienced'  THEN 1.0
          WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Intermediate' THEN 0.75
          WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Intermediate' THEN 1.0
          WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Experienced'  THEN 0.75
          ELSE 0.5
        END AS score
    FROM user_role_names ur
    LEFT JOIN engineer_profiles ep ON ep.user_id = ur.user_id
    WHERE ur.role = 'engineer'
      AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(ep.is_available, true)
      AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
      AND NOT EXISTS (
        SELECT 1 FROM guest_calls gc
         WHERE gc.claimed_by = ur.user_id
           AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM engineer_match_offers o
         WHERE o.intake_id       = _intake.id
           AND o.guest_call_id   = _intake.guest_call_id
           AND o.engineer_user_id = ur.user_id
      )
  )
  SELECT user_id, score
    INTO _rec
    FROM scored
   ORDER BY score DESC, random()
   LIMIT 1;

  IF _rec.user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO engineer_match_offers (
    intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
  ) VALUES (
    _intake.id, _intake.guest_call_id, _rec.user_id, _intake.customer_user_id, COALESCE(_rec.score, 0)
  )
  RETURNING * INTO _offer;

  RETURN NEXT _offer;
END $$;

-- One-shot reap on apply so anyone currently stuck online-but-silent
-- gets cleaned up the moment this migration lands.
SELECT public.reap_idle_engineers();

COMMIT;
