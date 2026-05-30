-- ============================================================================
-- Offer ring timers: 30s per tier (specific engineer + post-decline broadcast),
-- 90s for the customer's "Try again" broadcast.
-- ============================================================================
-- The customer's matching window is 90s (MatchingClient). That window is meant
-- to be three 30s ring tiers: best engineer (30s) → next-best (30s) → broadcast
-- to the rest (30s). Escalation between tiers happens when an offer lapses
-- (expire_stale_offers flips it 'expired' → advance trigger → match_engineer).
--
-- Bug: the live engineer_match_offers.expires_at default had drifted to 90s
-- (see 20260520200000; the later 25s change in 20260523120000 never reached
-- prod). With 90s offers the FIRST engineer rang for the entire window and no
-- timeout escalation ever happened — the tiers collapsed into "one engineer,
-- then nothing."
--
-- Fix:
--   • match_engineer sets expires_at EXPLICITLY per call. The only path that
--     passes _force_broadcast=true is retry_broadcast_match ("Try again"),
--     which should ring everyone for the full 90s window. Every other path
--     (tier 1 best, tier 2 next-best, tier 3 auto-broadcast after two declines)
--     uses 30s.
--   • Heal the column default to 30s so any other insert that omits expires_at
--     (e.g. the supervisor's manual broadcast endpoint) also rings 30s.
--
-- Everything else is identical to 20260530160000 (the canonical tiered matcher:
-- _broadcast at _prior>=2, manual is_available gate, stale-decline reset,
-- guest_call_id scoping). Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_match_offers
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 seconds');

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
  _expires    timestamptz;
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

  -- Fresh ring cycle for this call → clear decline memory carried over from a
  -- previous call on this (reused) intake. Within a single call's escalation
  -- _prior > 0, so genuine declines are preserved there.
  IF _prior = 0 AND COALESCE(array_length(_intake.declined_by, 1), 0) > 0 THEN
    UPDATE client_intakes SET declined_by = '{}'::uuid[] WHERE id = _intake.id;
    _intake.declined_by := '{}'::uuid[];
  END IF;

  -- Tier 1 (0 prior) → best; tier 2 (1 prior) → 2nd best; tier 3 (2+) or a
  -- forced "Try again" → broadcast to everyone still eligible.
  _broadcast := _force_broadcast OR (_prior >= 2);

  -- Ring window: a forced "Try again" broadcast holds the full 90s customer
  -- window; every tiered ring (best / next-best / auto-broadcast) is 30s so
  -- the three tiers fit inside that same 90s window.
  _expires := now() + CASE WHEN _force_broadcast
                           THEN interval '90 seconds'
                           ELSE interval '30 seconds' END;

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
      intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score, expires_at
    ) VALUES (
      _intake.id, _intake.guest_call_id, _rec.user_id, _intake.customer_user_id, _rec.score, _expires
    )
    RETURNING * INTO _offer;
    RETURN NEXT _offer;
    _any := true;
    IF NOT _broadcast THEN
      EXIT;   -- tiers 1 & 2 ring exactly ONE
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
