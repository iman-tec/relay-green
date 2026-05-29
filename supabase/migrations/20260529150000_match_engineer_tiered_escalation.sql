-- ============================================================================
-- match_engineer: tiered auto-escalation on decline
-- ============================================================================
-- Supersedes the broadcast-everyone behaviour from
-- 20260529100000_match_engineer_broadcast_all.sql. Two matching modes,
-- chosen per intake:
--
-- ── GUEST (Try-Relay) customers → BROADCAST from the first ring ──────────
--   A guest from the Try-Relay funnel is an ANONYMOUS auth user
--   (signInAnonymously). They want the fastest possible connect, so we
--   ring EVERY eligible online engineer at once (first-accept-wins) right
--   away — no polite sequential escalation. If they all decline ⇒
--   supervisor (reassign_needed).
--
-- ── Regular (signed-in) customers → BEST then BROADCAST ──────────────────
--   First ring (0 prior offers) → the single BEST-fit online engineer.
--   On the FIRST decline/expiry  → BROADCAST to every remaining eligible
--                                   online engineer at once (first-accept
--                                   -wins). No "2nd-best single" middle step.
--   Exhausted (no one left)      → flag the session reassign_needed = true
--                                   so the SUPERVISOR picks it up. No more
--                                   auto-matching.
--
-- The escalation is driven entirely by re-invocation: the
-- advance_match_on_offer_close trigger (20260528032000) already calls
-- match_engineer() each time a pending offer flips to declined/expired and
-- no other offer is still pending. This function just decides WHO to ring
-- based on (a) whether the customer is an anonymous guest, and (b) how many
-- offers have already gone out for the intake.
--
-- "Already-offered" engineers (any prior offer row for this intake) and
-- engineers in client_intakes.declined_by are excluded, so each ring
-- targets someone new and a declined engineer is never re-rung.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake     public.client_intakes;
  _offer      public.engineer_match_offers;
  _rec        record;
  _prior      int;
  _is_guest   boolean;
  _broadcast  boolean;
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

  -- Is this an anonymous Try-Relay guest? They broadcast from the start.
  -- NULL / not-found customer_user_id → treated as a regular customer.
  SELECT COALESCE(u.is_anonymous, false) INTO _is_guest
    FROM auth.users u
   WHERE u.id = _intake.customer_user_id;
  _is_guest := COALESCE(_is_guest, false);

  -- How many offers have already gone out for this intake (any status)?
  --   0  → first ring: the single best-fit engineer.
  --   1+ → broadcast to everyone still eligible.
  SELECT count(*) INTO _prior
    FROM engineer_match_offers
   WHERE intake_id = _intake.id
     AND guest_call_id = _intake.guest_call_id;

  -- Guests broadcast from the very first ring. Regular customers get one
  -- best-fit ring, then broadcast to everyone the moment that engineer
  -- declines/expires.
  _broadcast := _is_guest OR (_prior >= 1);

  -- Ranked eligible candidates. We ring just the top one on the first
  -- pass (best match); on broadcast we ring everyone — handled by the
  -- EXIT below.
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

    -- First (best-match) ring sends exactly one offer; broadcast keeps
    -- looping to ring everyone still eligible.
    IF NOT _broadcast THEN
      EXIT;
    END IF;
  END LOOP;

  -- Nobody left to ring. Hand off to the supervisor instead of silently
  -- leaving the session queued with no live offer. (Directed declines
  -- already set this flag via the advance trigger; same surface.)
  IF NOT _any THEN
    UPDATE guest_calls
       SET reassign_needed = true,
           updated_at = now()
     WHERE id = _intake.guest_call_id
       AND status = 'queued';
  END IF;

  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;

COMMIT;
