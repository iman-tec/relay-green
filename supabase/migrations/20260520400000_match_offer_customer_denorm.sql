-- ============================================================================
-- Denormalise customer_user_id onto engineer_match_offers
-- ============================================================================
-- The customer's MatchingClient subscribes to engineer_match_offers in
-- Realtime so it can flip from "Ringing…" to "Engineer joined". The
-- existing RLS policy uses an EXISTS join into client_intakes — that works
-- fine for plain SELECTs, but Supabase Realtime evaluates RLS per-row at
-- emit time and EXISTS subqueries can fail to authorise the event,
-- silently dropping it. Symptom in the field: engineer accepts, session
-- flips to 'assigned', but the customer never gets the "accepted" event
-- and is stuck on "Finding engineer…".
--
-- Fix: stamp customer_user_id directly on each offer and switch the
-- customer RLS to a direct-equality check — that's the pattern Supabase
-- Realtime is known to deliver reliably.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_match_offers
  ADD COLUMN IF NOT EXISTS customer_user_id uuid;

-- Backfill from existing intake rows.
UPDATE public.engineer_match_offers o
SET    customer_user_id = ci.customer_user_id
FROM   public.client_intakes ci
WHERE  ci.id = o.intake_id
  AND  o.customer_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_match_offers_customer
  ON public.engineer_match_offers (customer_user_id, status);

-- Replace the EXISTS-based customer policy with a direct-equality one so
-- Realtime delivers UPDATE events to the customer reliably.
DROP POLICY IF EXISTS "Customer reads offers on own intake" ON public.engineer_match_offers;
CREATE POLICY "Customer reads offers on own intake" ON public.engineer_match_offers
  FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());

-- Update match_engineer to stamp the new column at insert time. Pulls the
-- customer_user_id from the intake we just resolved at the top of the
-- function — adds one column to the existing INSERT.
CREATE OR REPLACE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake      public.client_intakes;
  _candidate   uuid;
  _score       numeric;
  _offer       public.engineer_match_offers;
BEGIN
  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  WITH scored AS (
    SELECT
      ep.user_id,
      (
        COALESCE(cardinality(ARRAY(
          SELECT unnest(ep.technologies) INTERSECT SELECT unnest(_intake.technologies)
        )), 0)::numeric * 1.0
        +
        CASE ep.experience_level
          WHEN 'Experienced'  THEN 1.5
          WHEN 'Intermediate' THEN 1.0
          ELSE                     0.5
        END
      ) AS score
    FROM engineer_profiles ep
    WHERE ep.is_available = true
      AND ep.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
      AND NOT EXISTS (
        SELECT 1 FROM guest_calls gc
        WHERE gc.claimed_by = ep.user_id
          AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
      )
      AND NOT EXISTS (
        SELECT 1 FROM engineer_match_offers o
        WHERE o.intake_id = _intake.id
          AND o.engineer_user_id = ep.user_id
          AND o.status IN ('pending','accepted')
      )
      AND NOT EXISTS (
        SELECT 1 FROM engineer_match_offers o2
        WHERE o2.engineer_user_id = ep.user_id
          AND o2.status = 'pending'
          AND o2.expires_at > now()
      )
  )
  SELECT user_id, score INTO _candidate, _score
    FROM scored
    ORDER BY score DESC, random()
    LIMIT 1;

  IF _candidate IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO engineer_match_offers (
    intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
  ) VALUES (
    _intake.id, _intake.guest_call_id, _candidate, _intake.customer_user_id, COALESCE(_score, 0)
  )
  RETURNING * INTO _offer;

  RETURN _offer;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;

COMMIT;
