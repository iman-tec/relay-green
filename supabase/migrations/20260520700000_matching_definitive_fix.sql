-- ============================================================================
-- Matching flow — definitive rewrite (self-contained)
-- ============================================================================
-- Sets match_engineer, accept_match, and list_queue to their final
-- working state in ONE migration. Safe to apply regardless of which
-- earlier 20260520*** migrations did or didn't take.
--
-- Root causes addressed:
--
-- (1) match_engineer used to source candidates from engineer_profiles
--     (INNER JOIN). Engineers who hadn't completed /staff/onboarding had
--     no row there → were filtered out → zero offers created → zero rings
--     reached the dashboard → customer saw "No response yet".
--     Fix: source from user_roles, LEFT JOIN engineer_profiles for
--     scoring. An engineer without a profile still gets rung (score 0).
--
-- (2) The customer's MatchingClient queries offers by intake_id only.
--     When the customer retries, intake_id stays the same but a new
--     guest_call_id is minted. Old offers (status 'expired'/'declined')
--     for previous sessions show up in the query result and the phase
--     logic treats them as "all terminal" → "No response yet" even when
--     fresh pending offers exist for the new session.
--     Fix: scope the "already offered?" check inside match_engineer to
--     the CURRENT guest_call_id so new offers are always created for a
--     new session. The customer-side filter is also scoped by
--     guest_call_id in MatchingClient.fetchLatest.
--
-- (3) accept_match must clear sibling pending offers so other engineers'
--     ring modals dismiss as soon as one engineer accepts.
--
-- (4) list_queue must hide queued sessions ONLY while a live offer is
--     pending. Once the 90-second offers expire without acceptance, the
--     session re-appears in /dashboard queue so any engineer can claim
--     it via the legacy claim_session RPC. Two parallel paths for
--     engineers to pick up: push-ring modal or pull queue.
-- ============================================================================

BEGIN;

-- ── client_intakes UPDATE policy ───────────────────────────────────────────
-- Bug surfaced when clicking "+" on an existing project:
--   42501: new row violates row-level security policy (USING expression)
--          for table "client_intakes"
-- Cause: 20260520100000 created SELECT + INSERT policies but no UPDATE
-- policy. handleStartInProject does:
--   UPDATE client_intakes SET guest_call_id=…, declined_by='{}' WHERE id=…
-- and IntakeClient.submit does an upsert that takes the UPDATE branch when
-- the (project_id, customer_user_id) row already exists. Both fail without
-- a permissive UPDATE policy.
DROP POLICY IF EXISTS "Owner update own intake" ON public.client_intakes;
CREATE POLICY "Owner update own intake" ON public.client_intakes
  FOR UPDATE TO authenticated
  USING (customer_user_id = auth.uid())
  WITH CHECK (customer_user_id = auth.uid());


-- ── match_engineer ─────────────────────────────────────────────────────────
-- The pre-broadcast signature returned a single row; broadcast returns
-- SETOF. PostgreSQL refuses to change return type via CREATE OR REPLACE,
-- so DROP first.

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

  IF _intake.guest_call_id IS NULL THEN
    -- No session attached to this intake yet — nothing to ring against.
    -- Return empty set; UI falls back to its "no engineer" state and the
    -- customer can retry once a session is bound.
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO engineer_match_offers (
    intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score
  )
  SELECT
    _intake.id,
    _intake.guest_call_id,
    ur.user_id,
    _intake.customer_user_id,
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
    )
  FROM user_roles ur
  LEFT JOIN engineer_profiles ep ON ep.user_id = ur.user_id
  WHERE ur.role = 'engineer'
    AND ur.user_id <> COALESCE(_intake.customer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    -- is_available defaults to true if there's no profile row yet — a
    -- fresh engineer who hasn't onboarded should still receive the ring.
    AND COALESCE(ep.is_available, true)
    AND ur.user_id <> ALL (COALESCE(_intake.declined_by, '{}'::uuid[]))
    -- Skip engineers currently in an active session.
    AND NOT EXISTS (
      SELECT 1 FROM guest_calls gc
      WHERE gc.claimed_by = ur.user_id
        AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
    )
    -- Per-session "already offered?" check. Old offers from previous
    -- sessions of the same intake don't block fresh offers for a new
    -- session.
    AND NOT EXISTS (
      SELECT 1 FROM engineer_match_offers o
      WHERE o.intake_id = _intake.id
        AND o.guest_call_id = _intake.guest_call_id
        AND o.engineer_user_id = ur.user_id
        AND o.status IN ('pending','accepted')
    )
  RETURNING *;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;


-- ── accept_match ───────────────────────────────────────────────────────────
-- Atomic flip pending→accepted + claim guest_calls. Once we successfully
-- claim, mark every OTHER pending offer for the same intake as expired
-- so the other rung engineers' ring modals dismiss themselves.

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
    UPDATE engineer_match_offers
       SET status='pending', responded_at=NULL
     WHERE id = _offer.id;
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Supersede all other pending offers for this intake. Each rung
  -- engineer's modal subscribes to their own offer; flipping these to
  -- 'expired' makes those modals dismiss automatically.
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


-- ── list_queue (offer-aware fallback) ──────────────────────────────────────
-- Engineers see a queued session in /dashboard ONLY when no live (pending,
-- not yet expired) offer exists for it. Once the 90s offers expire without
-- acceptance, the session re-appears here so any engineer can grab it via
-- claim_session — the legacy pull path.

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
