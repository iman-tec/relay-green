-- ============================================================================
-- Broadcast push-ring + queue fallback
-- ============================================================================
-- Two structural changes to the push-ring matching pipeline.
--
-- 1. match_engineer now BROADCASTS: it inserts an offer row for EVERY
--    eligible engineer (one query, no LIMIT 1) instead of just the top
--    scorer. First engineer to hit Accept wins via the existing atomic
--    claim inside accept_match; sibling offers are marked 'expired' so
--    their modals clear.
--
-- 2. list_queue reverts to the offer-aware (not strict-anonymous) filter
--    from bugs2.txt #4. An authenticated customer's queued session
--    re-appears in the legacy queue once every push-ring offer has
--    expired/declined — that gives engineers who weren't on /dashboard
--    when the offer fired a way to still pick the call up. The strict
--    "anonymous-only" filter from 20260520500000 created the "platform
--    has 2 engineers but call is showing nowhere" symptom because if
--    the single rung engineer wasn't online, NOBODY saw it.
--
-- The 90s offer TTL is unchanged. After all offers expire, the session
-- is visible in list_queue and any engineer can claim it via the legacy
-- claim_session RPC.
-- ============================================================================

BEGIN;

-- ── 1. match_engineer → broadcast ──────────────────────────────────────────
-- The previous signature returned a single offer row; broadcast returns
-- SETOF. PostgreSQL refuses to change return type via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.match_engineer(uuid);

CREATE FUNCTION public.match_engineer(_intake_id uuid)
RETURNS SETOF public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _intake public.client_intakes;
BEGIN
  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  -- Broadcast: insert one offer per eligible engineer.
  RETURN QUERY
  INSERT INTO engineer_match_offers (
    intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
  )
  SELECT
    _intake.id,
    _intake.guest_call_id,
    ep.user_id,
    _intake.customer_user_id,
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
    )
  FROM engineer_profiles ep
  WHERE ep.is_available = true
    AND ep.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
    -- Skip engineers currently in an active session.
    AND NOT EXISTS (
      SELECT 1 FROM guest_calls gc
      WHERE gc.claimed_by = ep.user_id
        AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
    )
    -- Skip engineers who already have a live offer on THIS intake (so a
    -- second match_engineer call doesn't double-ring the same person).
    AND NOT EXISTS (
      SELECT 1 FROM engineer_match_offers o
      WHERE o.intake_id = _intake.id
        AND o.engineer_user_id = ep.user_id
        AND o.status IN ('pending','accepted')
    )
  RETURNING *;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;


-- ── 2. accept_match → mark sibling offers superseded ──────────────────────
-- Same atomic flip as before plus: after we successfully claim the
-- session, mark every OTHER pending offer for this intake as 'expired' so
-- the other engineers' ring modals dismiss themselves automatically.

CREATE OR REPLACE FUNCTION public.accept_match(_offer_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _offer    public.engineer_match_offers;
  _session  public.guest_calls;
  _engineer text;
  _pod      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  UPDATE engineer_match_offers
     SET status='accepted', responded_at=now()
   WHERE id = _offer_id
     AND engineer_user_id = auth.uid()
     AND status = 'pending'
     AND expires_at > now()
  RETURNING * INTO _offer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_ACTIONABLE' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(NULLIF(full_name,''),'Engineer') INTO _engineer
    FROM profiles WHERE id = auth.uid();
  SELECT pod_id INTO _pod
    FROM pod_members WHERE user_id = auth.uid() LIMIT 1;

  UPDATE guest_calls SET
    status      = 'assigned',
    claimed_by  = auth.uid(),
    claimed_at  = now(),
    assigned_at = now(),
    agent_name  = COALESCE(_engineer, 'Engineer'),
    pod_id      = _pod,
    updated_at  = now()
  WHERE id = _offer.guest_call_id
    AND status IN ('queued','assigned')
    AND (claimed_by IS NULL OR claimed_by = auth.uid())
  RETURNING * INTO _session;

  IF NOT FOUND THEN
    -- Another engineer beat us to it (their accept_match won the
    -- guest_calls race). Roll back our offer and surface the race.
    UPDATE engineer_match_offers
       SET status='pending', responded_at=NULL
     WHERE id = _offer.id;
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Supersede all other pending offers on this intake. Each rung
  -- engineer's modal subscribes to their own offer row, so flipping
  -- those rows to 'expired' makes their modals dismiss.
  UPDATE engineer_match_offers
     SET status='expired', responded_at=now()
   WHERE intake_id = _offer.intake_id
     AND id <> _offer.id
     AND status = 'pending';

  PERFORM _log_session_event(
    _session.id, 'session.claimed', 'queued', 'assigned',
    jsonb_build_object(
      'engineer_id',   auth.uid(),
      'engineer_name', _engineer,
      'via',           'match_offer',
      'offer_id',      _offer.id
    )
  );

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session.id, 'system', 'Relay',
          format('👤 %s joined as engineer', COALESCE(_engineer, 'Engineer')));

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.accept_match(uuid) TO authenticated;


-- ── 3. list_queue → offer-aware fallback ──────────────────────────────────
-- Show every queued session that doesn't currently have a LIVE push-ring
-- offer. Sessions whose offers have all expired/declined re-appear here
-- so a late-joining engineer can still grab them. Anonymous sessions are
-- naturally included (no offers ever).

CREATE OR REPLACE FUNCTION public.list_queue()
RETURNS SETOF public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT (has_role(auth.uid(),'engineer') OR has_role(auth.uid(),'pod_lead') OR
          has_role(auth.uid(),'ops_manager') OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
  SELECT gc.* FROM guest_calls gc
   WHERE gc.status = 'queued'
     AND NOT EXISTS (
       SELECT 1 FROM engineer_match_offers o
       WHERE o.guest_call_id = gc.id
         AND o.status = 'pending'
         AND o.expires_at > now()
     )
   ORDER BY
     CASE gc.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
     gc.created_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.list_queue() TO authenticated;

COMMIT;
