-- ============================================================================
-- Presence is now FULLY MANUAL — kill all heartbeat/idle-driven auto-offline
-- ============================================================================
-- Engineers go online/offline ONLY via their explicit toggle (set_engineer_
-- presence) or logout. Nothing flips them automatically based on heartbeat
-- staleness or idle time. This removes the server-side reaper that was
-- demoting online-but-idle (e.g. background-tab) engineers to offline mid-
-- match — which is why a decline stopped forwarding to other online engineers.
--
-- Changes:
--   1. Unschedule the 10s reap_idle_engineers cron.
--   2. reap_idle_engineers() → no-op (kept as a stub so existing inline callers
--      stay harmless without rewriting them).
--   3. match_engineer() — re-defined to NOT reap and to ring every MANUALLY
--      online engineer (engineer_profiles.is_available = true), tiered:
--        best → 2nd best → broadcast to the rest. is_available is false for
--        busy/offline, so those are never rung.
--
-- (Client-side idle auto-offline in EngineerPresenceBall / EngineerPresenceBadge
--  is removed in the same change set.)
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- 1. Stop the every-10s auto-offline cron.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reap_idle_engineers';

-- 2. Neutralise the reaper. Presence only changes via the manual toggle now.
CREATE OR REPLACE FUNCTION public.reap_idle_engineers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- No-op: heartbeat/idle auto-offline disabled. Presence is manual.
  RETURN 0;
END $$;

-- 3. match_engineer: tiered over manually-online engineers, no presence reap.
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
  -- Only reap stuck SESSIONS (not engineer presence) so the candidate pool
  -- isn't polluted by engineers "in" a dead session. Presence is manual.
  PERFORM public.reap_stale_assigned_sessions();

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO _prior
    FROM engineer_match_offers
   WHERE intake_id = _intake.id
     AND guest_call_id = _intake.guest_call_id;

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
      -- Manually ONLINE only. is_available is true only for presence 'online'
      -- (busy/offline set it false), so busy/offline engineers are never rung.
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

  -- Nobody online to ring → supervisor manual assignment (no cancel).
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
