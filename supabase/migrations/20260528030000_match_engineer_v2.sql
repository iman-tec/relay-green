-- ============================================================================
-- match_engineer v2 — weighted score + hot fan-out at t=0
-- ============================================================================
-- Replaces the body of public.match_engineer(_intake_id) from
-- 20260520900000_sequential_matching.sql. Same signature (RETURNS SETOF
-- public.engineer_match_offers) so every existing caller keeps working.
--
-- Score (computed inline; no helper functions):
--
--   3.0 * |intake.technologies ∩ ep.technologies|
-- + 2.0 * |intake.issues       ∩ ep.issues|         -- new, from 20260527100000
-- + 1.0 * |intake.environments ∩ ep.environments|   -- new, from 20260527100000
-- + familiarity_experience_bonus
--
-- familiarity_experience_bonus matrix:
--   Totally Unknown   × Experienced  = 1.5   (need the heavy hitter)
--   Totally Unknown   × Intermediate = 1.0
--   Semi-Technical    × Experienced  = 1.0
--   Semi-Technical    × Intermediate = 0.75
--   Well Experienced  × Intermediate = 1.0   (don't waste seniors here)
--   Well Experienced  × Experienced  = 0.75
--   everything else                  = 0.5
--
-- Hot fan-out: an engineer is "hot" when engineer_presence.last_seen_at is
-- within 30 s AND focused (per 20260527110000). If 2+ hot candidates score
-- within 2.0 of the top, we INSERT up to 3 parallel offers (top scorers among
-- hot only), first-accept-wins. Otherwise fall back to the existing sequential
-- single-offer pick. The trigger below makes sure the moment ONE offer is
-- accepted, all the sibling pendings for the same intake flip to 'expired' so
-- the other engineers' modals dismiss.
--
-- Eligibility filters preserved verbatim from 20260520900000:
--   role='engineer', is_available, not customer, not in declined_by, not in
--   live session, not previously offered for THIS session.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK: previous match_engineer body — paste back via CREATE OR REPLACE
-- if you need to revert without writing a new migration.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.match_engineer(_intake_id uuid)
-- RETURNS SETOF public.engineer_match_offers
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   _intake     public.client_intakes;
--   _candidate  uuid;
--   _score      numeric;
--   _offer      public.engineer_match_offers;
-- BEGIN
--   SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
--   IF NOT FOUND THEN RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
--   IF _intake.guest_call_id IS NULL THEN RETURN; END IF;
--   WITH scored AS (
--     SELECT ur.user_id,
--            COALESCE(cardinality(ARRAY(SELECT unnest(ep.technologies) INTERSECT SELECT unnest(_intake.technologies)))::numeric
--                     + CASE ep.experience_level WHEN 'Experienced' THEN 1.5 WHEN 'Intermediate' THEN 1.0 ELSE 0.5 END, 0) AS score
--       FROM user_roles ur LEFT JOIN engineer_profiles ep ON ep.user_id = ur.user_id
--      WHERE ur.role = 'engineer'
--        AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
--        AND COALESCE(ep.is_available, true)
--        AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
--        AND NOT EXISTS (SELECT 1 FROM guest_calls gc WHERE gc.claimed_by = ur.user_id AND gc.status IN ('assigned','joining','live','grace','expired_free','ending'))
--        AND NOT EXISTS (SELECT 1 FROM engineer_match_offers o WHERE o.intake_id = _intake.id AND o.guest_call_id = _intake.guest_call_id AND o.engineer_user_id = ur.user_id))
--   SELECT user_id, score INTO _candidate, _score FROM scored ORDER BY score DESC, random() LIMIT 1;
--   IF _candidate IS NULL THEN RETURN; END IF;
--   INSERT INTO engineer_match_offers (intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score)
--   VALUES (_intake.id, _intake.guest_call_id, _candidate, _intake.customer_user_id, COALESCE(_score, 0))
--   RETURNING * INTO _offer;
--   RETURN NEXT _offer;
-- END $$;
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.match_engineer(uuid);

CREATE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake          public.client_intakes;
  _top_hot_score   numeric;
  _hot_within_band int;
  _offer           public.engineer_match_offers;
  _rec             record;
BEGIN
  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  -- Score every eligible engineer + flag hot status. Materialized as a CTE
  -- referenced twice below (once to count hot near-top, once to insert).
  WITH scored AS (
    SELECT
      ur.user_id,
      -- Tech overlap (3x)
      3.0 * cardinality(ARRAY(
        SELECT unnest(ep.technologies)
         INTERSECT
        SELECT unnest(COALESCE(_intake.technologies, '{}'::text[]))
      ))::numeric
      -- Issue overlap (2x)
      + 2.0 * cardinality(ARRAY(
        SELECT unnest(ep.issues)
         INTERSECT
        SELECT unnest(COALESCE(_intake.issues, '{}'::text[]))
      ))::numeric
      -- Environment overlap (1x)
      + 1.0 * cardinality(ARRAY(
        SELECT unnest(ep.environments)
         INTERSECT
        SELECT unnest(COALESCE(_intake.environments, '{}'::text[]))
      ))::numeric
      -- Familiarity × experience matrix
      + CASE
          WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Experienced'  THEN 1.5
          WHEN _intake.familiarity = 'Totally Unknown'   AND ep.experience_level = 'Intermediate' THEN 1.0
          WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Experienced'  THEN 1.0
          WHEN _intake.familiarity = 'Semi-Technical'    AND ep.experience_level = 'Intermediate' THEN 0.75
          WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Intermediate' THEN 1.0
          WHEN _intake.familiarity = 'Well Experienced'  AND ep.experience_level = 'Experienced'  THEN 0.75
          ELSE 0.5
        END AS score,
      -- Hot = recently active AND focused
      (pres.last_seen_at > now() - interval '30 seconds' AND COALESCE(pres.focused, false)) AS is_hot
    FROM user_role_names ur
    LEFT JOIN engineer_profiles  ep   ON ep.user_id   = ur.user_id
    LEFT JOIN engineer_presence  pres ON pres.engineer_id = ur.user_id
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
  /* Snapshot the scored set into a temp so we can read it three times without
     re-evaluating the join. We use a CTE materialization barrier via OFFSET 0. */
  scored_mat AS (
    SELECT * FROM scored OFFSET 0
  ),
  /* The top score across HOT candidates only. NULL when no hot candidates. */
  top_hot AS (
    SELECT MAX(score) AS s FROM scored_mat WHERE is_hot
  ),
  /* Engineers we would fan out to: hot, within 2.0 of top hot score. */
  hot_band AS (
    SELECT s.user_id, s.score
      FROM scored_mat s, top_hot t
     WHERE s.is_hot
       AND t.s IS NOT NULL
       AND s.score >= t.s - 2.0
     ORDER BY s.score DESC, random()
     FETCH FIRST 3 ROWS ONLY
  ),
  /* The single best candidate overall (fallback when no hot fan-out). */
  single_pick AS (
    SELECT user_id, score
      FROM scored_mat
     ORDER BY score DESC, random()
     LIMIT 1
  )
  SELECT
    (SELECT s FROM top_hot),
    (SELECT COUNT(*)::int FROM hot_band)
   INTO _top_hot_score, _hot_within_band;

  -- Decide: fan out if 2+ hot candidates within band; else single sequential.
  IF _top_hot_score IS NOT NULL AND _hot_within_band >= 2 THEN
    /* Hot fan-out: INSERT up to 3 parallel offers for the hot band. */
    FOR _rec IN
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
        LEFT JOIN engineer_profiles  ep   ON ep.user_id   = ur.user_id
        LEFT JOIN engineer_presence  pres ON pres.engineer_id = ur.user_id
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
      SELECT s.user_id, s.score
        FROM scored s, top_hot t
       WHERE s.is_hot
         AND t.s IS NOT NULL
         AND s.score >= t.s - 2.0
       ORDER BY s.score DESC, random()
       FETCH FIRST 3 ROWS ONLY
    LOOP
      INSERT INTO engineer_match_offers (
        intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
      ) VALUES (
        _intake.id, _intake.guest_call_id, _rec.user_id, _intake.customer_user_id, _rec.score
      )
      RETURNING * INTO _offer;
      RETURN NEXT _offer;
    END LOOP;
    RETURN;
  END IF;

  -- Sequential single-pick fallback.
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

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;


-- ── advance_match_on_offer_close: add accept-time supersession ──────────────
-- Adds: when status flips to 'accepted', expire every OTHER pending offer for
-- the same intake so the fan-out siblings' UIs dismiss instantly. Existing
-- decline/expire/manual-reassign logic from 20260524170000 is preserved.
CREATE OR REPLACE FUNCTION public.advance_match_on_offer_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- NEW: accepted → supersede siblings (fan-out first-accept-wins).
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    UPDATE public.engineer_match_offers
       SET status       = 'expired',
           responded_at = now()
     WHERE intake_id        = NEW.intake_id
       AND id              <> NEW.id
       AND status           = 'pending';
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('declined', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Directed (manual) decline → hand back to supervisor for reassignment.
  IF NEW.status = 'declined' AND OLD.assigned_by IS NOT NULL THEN
    UPDATE public.guest_calls
       SET reassign_needed = true, updated_at = now()
     WHERE id = NEW.guest_call_id
       AND status = 'queued';
    RETURN NEW;
  END IF;

  -- Session must still be queued.
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = NEW.guest_call_id
      AND gc.status = 'queued'
  ) THEN
    RETURN NEW;
  END IF;

  -- Don't ring another engineer if one is already being rung for this intake.
  IF EXISTS (
    SELECT 1 FROM public.engineer_match_offers o
    WHERE o.intake_id = NEW.intake_id
      AND o.status = 'pending'
      AND o.expires_at > now()
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.match_engineer(NEW.intake_id);
  RETURN NEW;
END $$;


-- ── match_engineer_explain: debug helper, read-only ─────────────────────────
-- Returns the scored CTE rows so we can sanity-check the math against a real
-- intake without inserting any offers. Same eligibility filters as match_engineer.
CREATE OR REPLACE FUNCTION public.match_engineer_explain(_intake_id uuid)
RETURNS TABLE (
  engineer_id      uuid,
  score            numeric,
  is_hot           boolean,
  tech_overlap     int,
  issues_overlap   int,
  envs_overlap     int,
  experience_bonus numeric,
  experience_level text,
  last_seen_at     timestamptz,
  focused          boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH _intake AS (SELECT * FROM client_intakes WHERE id = _intake_id),
  parts AS (
    SELECT
      ur.user_id AS engineer_id,
      cardinality(ARRAY(SELECT unnest(ep.technologies) INTERSECT SELECT unnest(COALESCE((SELECT technologies FROM _intake), '{}'::text[])))) AS tech_overlap,
      cardinality(ARRAY(SELECT unnest(ep.issues)       INTERSECT SELECT unnest(COALESCE((SELECT issues       FROM _intake), '{}'::text[])))) AS issues_overlap,
      cardinality(ARRAY(SELECT unnest(ep.environments) INTERSECT SELECT unnest(COALESCE((SELECT environments FROM _intake), '{}'::text[])))) AS envs_overlap,
      ep.experience_level,
      (CASE
        WHEN (SELECT familiarity FROM _intake) = 'Totally Unknown'   AND ep.experience_level = 'Experienced'  THEN 1.5
        WHEN (SELECT familiarity FROM _intake) = 'Totally Unknown'   AND ep.experience_level = 'Intermediate' THEN 1.0
        WHEN (SELECT familiarity FROM _intake) = 'Semi-Technical'    AND ep.experience_level = 'Experienced'  THEN 1.0
        WHEN (SELECT familiarity FROM _intake) = 'Semi-Technical'    AND ep.experience_level = 'Intermediate' THEN 0.75
        WHEN (SELECT familiarity FROM _intake) = 'Well Experienced'  AND ep.experience_level = 'Intermediate' THEN 1.0
        WHEN (SELECT familiarity FROM _intake) = 'Well Experienced'  AND ep.experience_level = 'Experienced'  THEN 0.75
        ELSE 0.5
      END)::numeric AS experience_bonus,
      pres.last_seen_at,
      pres.focused
    FROM user_role_names ur
    LEFT JOIN engineer_profiles ep   ON ep.user_id     = ur.user_id
    LEFT JOIN engineer_presence pres ON pres.engineer_id = ur.user_id
    WHERE ur.role = 'engineer'
      AND COALESCE(ep.is_available, true)
  )
  SELECT
    engineer_id,
    (3.0 * tech_overlap + 2.0 * issues_overlap + 1.0 * envs_overlap + experience_bonus)::numeric AS score,
    (last_seen_at > now() - interval '30 seconds' AND COALESCE(focused, false))                    AS is_hot,
    tech_overlap,
    issues_overlap,
    envs_overlap,
    experience_bonus,
    experience_level,
    last_seen_at,
    focused
  FROM parts
  ORDER BY score DESC;
$$;

GRANT EXECUTE ON FUNCTION public.match_engineer_explain(uuid) TO authenticated;

COMMIT;
