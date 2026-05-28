-- ============================================================================
-- Presence/matcher self-heal: end the "engineer stuck on Busy" trap
-- ============================================================================
-- Bug observed in production: engineer Freya clicked "Online" in the picker,
-- the UI showed Online for a moment, then snapped back to Busy. The matcher
-- then refused to ring her — customer saw "No engineers are online right now"
-- even though she was at her desk with the tab focused and heartbeating.
--
-- Root cause was a chain of events:
--   1. A prior match left a guest_calls row in status='assigned' that never
--      transitioned (engineer accepted, then the call surface never finished
--      mounting → no joined_at, no end event).
--   2. The client-side EngineerPresenceBall.tsx auto-watcher subscribes to
--      guest_calls and treats ANY row claimed by the engineer in status
--      ('assigned','joining','live','grace') as "on a call" → auto-writes
--      presence_state='busy' via set_engineer_presence.
--   3. So every time the engineer clicked Online, the stale assigned row
--      re-fired the auto-watcher within ~50ms and forced her back to Busy.
--   4. The matcher's eligibility filter (is_available=true) then excluded
--      her, customer saw "no engineers".
--
-- A previous reaper (reap_stale_assigned_sessions, 20260528061000) was
-- written but ONLY ran when the customer clicked "Try again" in
-- MatchingClient.tsx:256, wrapped in a try/catch that swallows missing-
-- function errors. So in practice it never executed on first-attempt matches
-- and never executed when the engineer toggled herself online.
--
-- This migration self-heals at the two natural choke points:
--
--   A. set_engineer_presence('online') reaps the engineer's own stale rows
--      BEFORE flipping presence_state. So the auto-watcher's next refresh
--      sees zero active calls and doesn't re-busy her.
--
--   B. match_engineer() reaps everyone's stale rows at the top, so the very
--      first match attempt on a fresh intake self-heals.
--
-- Also re-defines reap_stale_assigned_sessions() idempotently so this
-- migration is self-contained (works even if 20260528060000/061000 weren't
-- applied to live yet — which they currently aren't per `supabase migration
-- list --linked`).
-- ============================================================================

BEGIN;

-- ── reaper (idempotent re-definition) ──────────────────────────────────────
-- Flips status from assigned/joining → abandoned when EITHER:
--   • the engineer accepted but never joined the call surface, OR
--   • the engineer's heartbeat is dead (no presence ping for >60s).
-- Bounded UPDATE; cheap; safe to call from anywhere.
CREATE OR REPLACE FUNCTION public.reap_stale_assigned_sessions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _count int;
BEGIN
  UPDATE public.guest_calls AS gc
     SET status = 'abandoned',
         updated_at = now()
   WHERE gc.status IN ('assigned', 'joining')
     AND gc.claimed_by IS NOT NULL
     AND gc.assigned_at < now() - interval '60 seconds'
     AND (
       gc.joined_at IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public.engineer_presence p
          WHERE p.engineer_id = gc.claimed_by
            AND p.last_seen_at > now() - interval '60 seconds'
       )
     );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.reap_stale_assigned_sessions() TO authenticated;

-- ── set_engineer_presence: reap-then-flip when going online ────────────────
-- Same signature, same behavior for 'busy' and 'offline'. The only addition
-- is the PERFORM reap_stale_assigned_sessions() inside the 'online' branch —
-- so the moment an engineer hits Online, any ghost-call row for her gets
-- cleared in the same transaction before is_available flips to true. The
-- client's auto-watcher then sees a clean call-list and doesn't fight the
-- transition.
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
  -- otherwise use to re-flip her to busy. Bounded to her own claimed
  -- rows + the same age/heartbeat criteria as the global reaper.
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

-- ── match_engineer: self-heal at top of every match attempt ────────────────
-- Same logic as 20260528033000 (fanout materialize), plus a PERFORM at the
-- top that reaps everyone's stale rows. This catches the case where the
-- engineer DIDN'T toggle herself online (so set_engineer_presence's local
-- reap didn't fire) but the matcher still wants to consider her — e.g. she
-- was already 'online' but had a residual assigned row from a different
-- earlier session that ended badly.
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
  PERFORM public.reap_stale_assigned_sessions();

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  -- ── Decide fan-out vs single ─────────────────────────────────────────
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

  -- ── Sequential single-pick fallback ─────────────────────────────────
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

-- One-shot cleanup of anything currently stuck the moment this lands.
SELECT public.reap_stale_assigned_sessions();

COMMIT;
