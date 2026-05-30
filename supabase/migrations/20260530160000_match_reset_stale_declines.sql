-- ============================================================================
-- match_engineer: clear STALE declined_by at the start of each new call
-- ============================================================================
-- Bug: declined_by lives on client_intakes, but an intake is reused across
-- many calls (one intake per customer-project). Engineers who declined a
-- PREVIOUS call stayed in declined_by forever, so a brand-new call on the same
-- intake excluded them — leaving few/no eligible engineers and dropping the
-- caller straight to reassign with no forwarding.
--
-- Fix: when match_engineer runs the FIRST ring of a call (no offers yet for
-- this guest_call → _prior = 0), wipe declined_by. That's a fresh ring cycle;
-- nobody has declined THIS call yet. Declines still accumulate WITHIN a call
-- (tier 2/3 have _prior > 0, so the memory is preserved during one escalation).
--
-- Everything else matches 20260530140000 (tiered best→2nd→broadcast, manual
-- is_available gate, no presence reap). Idempotent.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.match_engineer(uuid);
CREATE OR REPLACE FUNCTION public.match_engineer(
  _intake_id      uuid,
  _force_broadcast boolean DEFAULT false
)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake     public.client_intakes;
  _prior      int;
  _broadcast  boolean;
  _offer      public.engineer_match_offers;
  _rec        record;
  _any        boolean := false;
BEGIN
  PERFORM public.reap_stale_assigned_sessions();

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  -- How many engineers have already been rung for THIS call (guest_call).
  SELECT count(*) INTO _prior
    FROM engineer_match_offers
   WHERE intake_id = _intake.id
     AND guest_call_id = _intake.guest_call_id;

  -- Fresh ring cycle for this call → clear any decline memory carried over
  -- from a previous call on this (reused) intake. Within a single call's
  -- escalation _prior > 0, so genuine declines are preserved there.
  IF _prior = 0 AND COALESCE(array_length(_intake.declined_by, 1), 0) > 0 THEN
    UPDATE client_intakes SET declined_by = '{}'::uuid[] WHERE id = _intake.id;
    _intake.declined_by := '{}'::uuid[];
  END IF;

  -- Tier 1 (0 prior) → best; tier 2 (1 prior) → 2nd best; tier 3 (2+) or a
  -- forced "Try again" → broadcast to everyone still eligible.
  _broadcast := _force_broadcast OR (_prior >= 2);

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
    JOIN engineer_profiles ep ON ep.user_id = ur.user_id
    WHERE ur.role = 'engineer'
      AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(ep.is_available, false)
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
    ORDER BY 2 DESC, random()
  LOOP
    INSERT INTO engineer_match_offers (
      intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
    ) VALUES (
      _intake.id, _intake.guest_call_id, _rec.user_id, _intake.customer_user_id, _rec.score
    )
    RETURNING * INTO _offer;
    RETURN NEXT _offer;
    _any := true;
    IF NOT _broadcast THEN
      EXIT;
    END IF;
  END LOOP;

  IF NOT _any THEN
    UPDATE guest_calls
       SET reassign_needed = true,
           updated_at = now()
     WHERE id = _intake.guest_call_id
       AND status = 'queued';
  END IF;

  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid, boolean) TO authenticated;

COMMIT;
