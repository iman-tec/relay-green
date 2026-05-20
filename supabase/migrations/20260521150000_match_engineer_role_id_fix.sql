-- ============================================================================
-- match_engineer: fix stale user_roles.role reference
-- ============================================================================
-- match_engineer was last redefined in 20260520900000_sequential_matching.sql
-- with `WHERE ur.role = 'engineer'`. The 2026-05-20 role refactor
-- (20260521120000_roles_lookup_fk.sql) dropped that text column in favour
-- of role_id + a roles lookup, so the function now fails to find any
-- engineers — the /intake matching screen shows "No engineers are online"
-- regardless of how many engineers exist.
--
-- Swapping to the user_role_names view restores the original behaviour
-- (the view exposes the canonical role *name* by joining role_id → roles).
-- Body is otherwise identical to the 20260520900000 definition.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.match_engineer(uuid);

CREATE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake     public.client_intakes;
  _candidate  uuid;
  _score      numeric;
  _offer      public.engineer_match_offers;
BEGIN
  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  -- Pick the best eligible engineer.
  WITH scored AS (
    SELECT
      ur.user_id,
      COALESCE(
        (
          cardinality(ARRAY(
            SELECT unnest(ep.technologies) INTERSECT SELECT unnest(_intake.technologies)
          ))::numeric
          +
          CASE ep.experience_level
            WHEN 'Experienced'  THEN 1.5
            WHEN 'Intermediate' THEN 1.0
            ELSE                     0.5
          END
        ),
        0
      ) AS score
    FROM user_role_names ur
    LEFT JOIN engineer_profiles ep ON ep.user_id = ur.user_id
    WHERE ur.role = 'engineer'
      AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(ep.is_available, true)
      AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
      -- Skip engineers currently in a live session
      AND NOT EXISTS (
        SELECT 1 FROM guest_calls gc
        WHERE gc.claimed_by = ur.user_id
          AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
      )
      -- Skip engineers we already tried for THIS session
      AND NOT EXISTS (
        SELECT 1 FROM engineer_match_offers o
        WHERE o.intake_id = _intake.id
          AND o.guest_call_id = _intake.guest_call_id
          AND o.engineer_user_id = ur.user_id
      )
  )
  SELECT user_id, score
    INTO _candidate, _score
    FROM scored
   ORDER BY score DESC, random()
   LIMIT 1;

  IF _candidate IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO engineer_match_offers (
    intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
  ) VALUES (
    _intake.id, _intake.guest_call_id, _candidate, _intake.customer_user_id, COALESCE(_score, 0)
  )
  RETURNING * INTO _offer;

  RETURN NEXT _offer;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;

COMMIT;
