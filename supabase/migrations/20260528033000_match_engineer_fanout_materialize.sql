-- ============================================================================
-- match_engineer v2 — materialize fan-out candidates before INSERT
-- ============================================================================
-- The fan-out branch in 20260527120000 iterated a cursor whose CTE included
-- `NOT EXISTS (SELECT 1 FROM engineer_match_offers ...)`. Each iteration of
-- the FOR LOOP re-evaluated the cursor's next row against the current
-- transaction snapshot — which now included the offer we just INSERTed in
-- the previous iteration. So the second/third iteration could see fewer
-- candidates than the first, and we ended up inserting fewer offers than
-- intended when scores tied.
--
-- E2E smoke (S1_fanout): 3 hot engineers tied within band → expected 3
-- offers, actually got 2. The third candidate kept getting filtered out
-- mid-loop.
--
-- Fix: collect the candidate user_ids + scores into two arrays BEFORE any
-- INSERTs, then FOREACH over the arrays. The candidate set is now frozen
-- at the start of the fan-out.
-- ============================================================================

BEGIN;

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
    -- ── Hot fan-out: materialize top 3 candidates BEFORE any INSERT ──
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

    -- Insert one offer per pre-materialized candidate. The candidate list
    -- is frozen so subsequent INSERTs can't shrink it.
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

COMMIT;
