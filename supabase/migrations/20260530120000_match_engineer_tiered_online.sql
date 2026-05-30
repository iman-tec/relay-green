-- ============================================================================
-- match_engineer: tiered escalation over ONLINE engineers + try-again broadcast
-- ============================================================================
-- Fixes the "first engineer declines → call is dropped instead of forwarded"
-- bug. The live matcher was an out-of-sync variant; this restores a clean,
-- deterministic flow:
--
--   Tier 1 (0 prior offers)  → ring the single BEST-fit ONLINE engineer.
--   Tier 2 (1 prior offer)   → on decline/expiry, ring the single 2nd-best.
--   Tier 3 (2+ prior offers) → broadcast to EVERY remaining ONLINE engineer.
--   Exhausted (none left)    → flag the session reassign_needed (supervisor
--                              manual-assigns) WITHOUT cancelling — the
--                              customer keeps ringing within their own window
--                              and stays visible on the supervisor board.
--
-- Escalation is driven by the advance_match_on_offer_close trigger, which calls
-- match_engineer() each time an offer is declined/expired with no other pending
-- offer. ONLY engineers whose presence_state = 'online' are ever rung — offline
-- and busy engineers are never offered a call (per product requirement).
--
-- "Try again" (customer) → retry_broadcast_match(): clears the decline memory +
-- prior offers and broadcasts to every online engineer at once, so even
-- engineers who declined the first round are rung again.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- Drop the old single-arg signature so the new defaulted-arg version is the
-- sole resolution for both the trigger's match_engineer(intake) call and the
-- two-arg forced-broadcast call. (plpgsql bodies resolve the callee at runtime,
-- so dropping here doesn't break the advance trigger function.)
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
  -- Self-heal presence + stuck sessions before scoring so the candidate pool
  -- reflects who is genuinely reachable right now.
  PERFORM public.reap_idle_engineers();
  PERFORM public.reap_stale_assigned_sessions();

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  -- How many engineers have already been rung for this intake (any status).
  SELECT count(*) INTO _prior
    FROM engineer_match_offers
   WHERE intake_id = _intake.id
     AND guest_call_id = _intake.guest_call_id;

  -- Tier decision. Tiers 1 & 2 ring exactly one engineer (best, then 2nd best);
  -- tier 3 (and any forced "Try again") broadcasts to everyone still eligible.
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
      -- ONLINE presence only — offline/busy engineers are never rung.
      AND ep.presence_state = 'online'
      -- Skip engineers who already declined this intake.
      AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
      -- Skip engineers already busy in a live/assigned session.
      AND NOT EXISTS (
        SELECT 1 FROM guest_calls gc
         WHERE gc.claimed_by = ur.user_id
           AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
      )
      -- Skip engineers already offered this intake (rung once already).
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

    -- Tiers 1 & 2 ring exactly one engineer; only broadcast keeps looping.
    IF NOT _broadcast THEN
      EXIT;
    END IF;
  END LOOP;

  -- No eligible ONLINE engineer left → hand to the supervisor for manual
  -- assignment but DO NOT cancel: the customer keeps ringing within their
  -- window and remains visible/assignable on the supervisor board.
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

-- ── RPC: retry_broadcast_match ──────────────────────────────────────────────
-- Customer "Try again": wipe the decline memory + every prior offer for this
-- intake, then broadcast to EVERY online engineer at once (forced broadcast).
-- Owner-only. DELETE (not status-update) avoids re-firing the advance trigger.
CREATE OR REPLACE FUNCTION public.retry_broadcast_match(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake public.client_intakes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND OR _intake.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  DELETE FROM engineer_match_offers WHERE intake_id = _intake_id;
  UPDATE client_intakes SET declined_by = '{}'::uuid[] WHERE id = _intake_id;

  RETURN QUERY SELECT * FROM public.match_engineer(_intake_id, true);
END $$;

GRANT EXECUTE ON FUNCTION public.retry_broadcast_match(uuid) TO authenticated;

COMMIT;
