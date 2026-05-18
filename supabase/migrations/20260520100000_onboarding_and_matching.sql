-- ============================================================================
-- Onboarding & push-ring matching
-- ============================================================================
-- Adds:
--   engineer_profiles      : one row per engineer; skills self-declared via wizard
--   client_intakes         : per-session questionnaire snapshot
--   engineer_match_offers  : push-ring lifecycle (pending → accepted | declined | expired)
--
-- RPCs:
--   match_engineer(_intake_id)  : score available engineers, create one offer
--   accept_match(_offer_id)     : atomic claim + flip offer
--   decline_match(_offer_id)    : mark declined, add engineer to intake.declined_by
--   expire_stale_offers()       : pg_cron friendly; flips pending→expired past expires_at
--
-- The match flow is additive — existing pull-based claim_session is untouched.
-- Sessions that come through /intake are inserted with status='queued' first,
-- then atomically flipped to 'assigned' inside accept_match.
-- ============================================================================

BEGIN;

-- ── engineer_profiles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.engineer_profiles (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expertise         text[] NOT NULL DEFAULT '{}',
  technologies      text[] NOT NULL DEFAULT '{}',
  experience_level  text   NOT NULL CHECK (experience_level IN ('Beginner','Intermediate','Experienced')),
  issues            text[] NOT NULL DEFAULT '{}',
  environments      text[] NOT NULL DEFAULT '{}',
  is_available      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineer_profiles_avail
  ON public.engineer_profiles (is_available) WHERE is_available;

ALTER TABLE public.engineer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Engineers manage own profile" ON public.engineer_profiles;
CREATE POLICY "Engineers manage own profile" ON public.engineer_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read engineer profiles" ON public.engineer_profiles;
CREATE POLICY "Staff read engineer profiles" ON public.engineer_profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );


-- ── client_intakes ─────────────────────────────────────────────────────────
-- One row per session created via the wizard. guest_call_id is set after the
-- guest_calls row is inserted (wizard does both in the same transaction).

CREATE TABLE IF NOT EXISTS public.client_intakes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_call_id      uuid REFERENCES public.guest_calls(id) ON DELETE CASCADE,
  customer_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  familiarity        text NOT NULL CHECK (familiarity IN ('Totally Unknown','Semi-Technical','Well Experienced')),
  ai_tools_used      text NOT NULL,
  developing         text NOT NULL CHECK (developing IN ('Website','Mobile App','IoT System','AIML product')),
  technologies       text[] NOT NULL DEFAULT '{}',
  declined_by        uuid[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_intakes_guest_call ON public.client_intakes (guest_call_id);
CREATE INDEX IF NOT EXISTS idx_client_intakes_customer ON public.client_intakes (customer_user_id, created_at DESC);

ALTER TABLE public.client_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner read own intake" ON public.client_intakes;
CREATE POLICY "Owner read own intake" ON public.client_intakes
  FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());

DROP POLICY IF EXISTS "Owner insert own intake" ON public.client_intakes;
CREATE POLICY "Owner insert own intake" ON public.client_intakes
  FOR INSERT TO authenticated
  WITH CHECK (customer_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read intakes" ON public.client_intakes;
CREATE POLICY "Staff read intakes" ON public.client_intakes
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'engineer')
    OR has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );


-- ── engineer_match_offers ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.engineer_match_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id           uuid NOT NULL REFERENCES public.client_intakes(id) ON DELETE CASCADE,
  guest_call_id       uuid REFERENCES public.guest_calls(id) ON DELETE SET NULL,
  engineer_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','declined','expired')),
  match_score         numeric NOT NULL DEFAULT 0,
  offered_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  responded_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_match_offers_engineer_pending
  ON public.engineer_match_offers (engineer_user_id, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_match_offers_intake
  ON public.engineer_match_offers (intake_id, status);

ALTER TABLE public.engineer_match_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Engineer reads own offers" ON public.engineer_match_offers;
CREATE POLICY "Engineer reads own offers" ON public.engineer_match_offers
  FOR SELECT TO authenticated
  USING (engineer_user_id = auth.uid());

DROP POLICY IF EXISTS "Customer reads offers on own intake" ON public.engineer_match_offers;
CREATE POLICY "Customer reads offers on own intake" ON public.engineer_match_offers
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM client_intakes ci
    WHERE ci.id = engineer_match_offers.intake_id
      AND ci.customer_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Staff read all offers" ON public.engineer_match_offers;
CREATE POLICY "Staff read all offers" ON public.engineer_match_offers
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'pod_lead')
    OR has_role(auth.uid(), 'ops_manager')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'super_admin')
  );


-- ── RPC: match_engineer ────────────────────────────────────────────────────
-- Score available engineers and create one offer for the top match.
-- Returns the new offer row, or NULL when no candidate is available.
--
-- Score formula:
--   tech_overlap   × 1.0   (#technologies in common)
--   issue_overlap  × 0.8   (uses developing-type → issue heuristic)
--   env_overlap    × 0.5   (#environments — currently no env signal from intake)
--   exp_bonus      × 0.5   (Experienced=3, Intermediate=2, Beginner=1)
--
-- We can refine the issue heuristic later — for now it's a placeholder that
-- doesn't penalize engineers when intake lacks data.

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
      -- Skip engineers currently in an active session
      AND NOT EXISTS (
        SELECT 1 FROM guest_calls gc
        WHERE gc.claimed_by = ep.user_id
          AND gc.status IN ('assigned','joining','live','grace','expired_free','ending')
      )
      -- Skip engineers who already have a pending or accepted offer on
      -- this intake (prevents the same engineer being re-offered after
      -- their first offer expires before status flips)
      AND NOT EXISTS (
        SELECT 1 FROM engineer_match_offers o
        WHERE o.intake_id = _intake.id
          AND o.engineer_user_id = ep.user_id
          AND o.status IN ('pending','accepted')
      )
      -- Skip engineers with any other pending offer (so a single engineer
      -- only rings for one intake at a time)
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

  INSERT INTO engineer_match_offers (intake_id, guest_call_id, engineer_user_id, match_score)
  VALUES (_intake.id, _intake.guest_call_id, _candidate, COALESCE(_score, 0))
  RETURNING * INTO _offer;

  RETURN _offer;
END $$;

GRANT EXECUTE ON FUNCTION public.match_engineer(uuid) TO authenticated;


-- ── RPC: accept_match ──────────────────────────────────────────────────────

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
    -- Session vanished mid-flight (cancelled, race). Roll back the offer.
    UPDATE engineer_match_offers
       SET status='pending', responded_at=NULL
     WHERE id = _offer.id;
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  -- Note: we don't flip engineer_profiles.is_available here. The candidate
  -- filter in match_engineer already excludes engineers with an active
  -- session, so they naturally drop out of the pool until end_session
  -- clears their status. is_available remains a manual "online/away" toggle.

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


-- ── RPC: decline_match ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decline_match(_offer_id uuid)
RETURNS public.engineer_match_offers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _offer public.engineer_match_offers;
BEGIN
  UPDATE engineer_match_offers
     SET status='declined', responded_at=now()
   WHERE id = _offer_id
     AND engineer_user_id = auth.uid()
     AND status = 'pending'
  RETURNING * INTO _offer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_ACTIONABLE' USING ERRCODE='P0001';
  END IF;

  UPDATE client_intakes
     SET declined_by = array_append(declined_by, auth.uid())
   WHERE id = _offer.intake_id
     AND NOT (auth.uid() = ANY(declined_by));

  RETURN _offer;
END $$;

GRANT EXECUTE ON FUNCTION public.decline_match(uuid) TO authenticated;


-- ── RPC: expire_stale_offers ───────────────────────────────────────────────
-- Sweep pending offers past expires_at and flip them to 'expired'. Safe to
-- call from a pg_cron schedule or from the client when the customer polls.

CREATE OR REPLACE FUNCTION public.expire_stale_offers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _count int;
BEGIN
  UPDATE engineer_match_offers
     SET status='expired', responded_at=now()
   WHERE status='pending' AND expires_at < now();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_stale_offers() TO authenticated;


-- ── Realtime ───────────────────────────────────────────────────────────────
-- engineer_match_offers: engineers subscribe (incoming-ring modal), customers
-- subscribe (matching screen status). guest_calls is already published.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='engineer_match_offers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.engineer_match_offers;
  END IF;
END $$;

COMMIT;
