-- ============================================================================
-- Broadcast every match to every eligible online engineer
-- ============================================================================
-- Prior behaviour (20260528130000_match_engineer_inline_reap.sql):
--   • If 2+ "hot" engineers (focused tab + recent presence ping) were within
--     2.0 score of the top, fan out to the top 3.
--   • Otherwise pick exactly 1 engineer (sequential ringing).
--
-- Product change: a customer calling now broadcasts to EVERY online,
-- eligible engineer at once. First Accept wins via accept_match's atomic
-- claim — same as the existing fan-out path, just with no top-N cap and
-- no sequential fallback.
--
-- Eligibility filter is unchanged. An engineer is "online & ringable" when:
--   • role = 'engineer'
--   • is_available IS TRUE (NULL is treated as TRUE for legacy rows)
--   • not the calling customer
--   • not in the intake's declined_by list
--   • not currently claimed on a live/joining/assigned/grace/expired_free
--     /ending session
--   • not already offered this same intake (no duplicate offer row)
--
-- self-heal: keep the existing reap_stale_assigned_sessions() PERFORM at
-- the top so a residual ghost-call row doesn't block an otherwise-online
-- engineer.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake          public.client_intakes;
  _offer           public.engineer_match_offers;
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

  FOR _rec IN
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
         WHERE o.intake_id        = _intake.id
           AND o.guest_call_id    = _intake.guest_call_id
           AND o.engineer_user_id = ur.user_id
      )
    -- Order by score so the offer rows land in priority order — useful for
    -- engineer-side UIs that surface the highest-fit ring first when more
    -- than one engineer is staring at the inbox simultaneously.
    ORDER BY 2 DESC, random()
  LOOP
    INSERT INTO engineer_match_offers (
      intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
    ) VALUES (
      _intake.id, _intake.guest_call_id, _rec.user_id, _intake.customer_user_id, _rec.score
    )
    RETURNING * INTO _offer;
    RETURN NEXT _offer;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;

COMMIT;
