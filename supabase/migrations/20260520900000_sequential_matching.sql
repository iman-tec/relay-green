-- ============================================================================
-- Sequential matching — one engineer at a time, queued by score
-- ============================================================================
-- Until now match_engineer broadcasted offers to every eligible engineer
-- simultaneously (first-Accept-wins). The new behaviour:
--
--   1. match_engineer picks the SINGLE highest-scoring eligible engineer
--      who hasn't been offered yet for this session and creates one
--      offer for them.
--   2. If they decline → trigger fires → next-best engineer is offered.
--   3. If the 90s ring expires (expire_stale_offers cron / client sweep
--      flips status to 'expired') → trigger fires → next-best engineer.
--   4. If they accept → accept_match flips guest_calls to 'assigned' and
--      the trigger no-ops (sees session is no longer 'queued').
--   5. When the candidate pool is empty → match_engineer returns 0 rows;
--      the customer sees "no engineers available" UX.
--
-- Customer's existing "Ring again" / "Try Again" button becomes a manual
-- skip — it expires the current pending offer, which the same trigger
-- catches and advances on. New RPC skip_current_offer wraps that.
--
-- All other pieces (accept_match supersede, expire-on-session-terminal,
-- list_queue fallback) stay as-is.
-- ============================================================================

BEGIN;

-- ── match_engineer: pick ONE top-scoring engineer ─────────────────────────
-- Same eligibility filters as before, but ORDER BY score DESC, random()
-- and LIMIT 1 instead of inserting one row per eligible engineer.
--
-- Per-session "already offered?" check now excludes engineers with ANY
-- prior offer for this guest_call_id (regardless of status), so once an
-- engineer was rung for this session they don't get re-rung in the same
-- session. They become eligible again in the next session (declined_by
-- gets cleared at session start).

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
    FROM user_roles ur
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
      -- Skip engineers we already tried for THIS session (any status —
      -- they had their turn). Sequential queue means once we move past
      -- you, we don't loop back to you in the same session.
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
   ORDER BY score DESC, random()  -- random() = tiebreaker for equal scores
   LIMIT 1;

  IF _candidate IS NULL THEN
    RETURN;  -- No more eligible engineers — caller's UI handles this
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


-- ── advance_match_on_offer_close: the queue cycle ─────────────────────────
-- When the current pending offer flips to 'declined' or 'expired' and
-- the underlying session is still queued, auto-call match_engineer to
-- offer the next engineer in line.
--
-- No-ops in three cases:
--   • Status went to 'accepted' (we have an engineer; session is now
--     'assigned' — nothing to advance)
--   • Old status wasn't 'pending' (e.g. expired → expired)
--   • Underlying session is no longer 'queued' (cancelled, abandoned,
--     ended, assigned)
--
-- Doesn't recurse: match_engineer INSERTs a new offer row. INSERT
-- doesn't fire this UPDATE trigger.

CREATE OR REPLACE FUNCTION public.advance_match_on_offer_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only act on pending → declined/expired transitions.
  IF OLD.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('declined', 'expired') THEN
    RETURN NEW;
  END IF;

  -- Session must still be in the queued state (no engineer claimed,
  -- customer didn't cancel, watchdog didn't abandon).
  IF NOT EXISTS (
    SELECT 1 FROM public.guest_calls gc
    WHERE gc.id = NEW.guest_call_id
      AND gc.status = 'queued'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.match_engineer(NEW.intake_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS advance_match_on_offer_close_trg ON public.engineer_match_offers;
CREATE TRIGGER advance_match_on_offer_close_trg
  AFTER UPDATE OF status ON public.engineer_match_offers
  FOR EACH ROW
  WHEN (NEW.status IN ('declined','expired') AND OLD.status = 'pending')
  EXECUTE FUNCTION public.advance_match_on_offer_close();


-- ── skip_current_offer: manual advancement (customer-side "Ring next") ────
-- Lets the customer fast-forward without waiting for the 90s ring to
-- expire. Marks the current pending offer for this intake as 'expired';
-- the trigger above then auto-advances to the next engineer.
--
-- Only the intake owner can call it.

CREATE OR REPLACE FUNCTION public.skip_current_offer(_intake_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake public.client_intakes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  UPDATE engineer_match_offers
     SET status = 'expired',
         responded_at = now()
   WHERE intake_id = _intake_id
     AND status = 'pending';
  -- advance_match_on_offer_close_trg fires per row and queues the next
  -- engineer automatically.
END $$;

GRANT EXECUTE ON FUNCTION public.skip_current_offer(uuid) TO authenticated;

COMMIT;
