-- ============================================================================
-- Engineer/supervisor display aliases (privacy nicknames)
-- ============================================================================
-- Customers must never see staff real names. Each engineer gets a stable,
-- short, pronounceable alias (e.g. "Leo"). The alias is a CUSTOMER-FACING
-- projection only: guest_calls.agent_name + the "joined" chat line use the
-- alias, while staff/admin views and the session audit log keep the real
-- identity (claimed_by → profiles.full_name) for management + traceability.
--
--   engineer_profiles.display_alias  stable per-engineer nickname
--   assign_engineer_alias(_user)     idempotent: returns existing or assigns
--                                    an unused pool name (lazy + backfill)
--   accept_match / supervisor_assign_engineer  write the alias into agent_name
--
-- Alias is intentionally NOT unique-constrained: a rare duplicate friendly
-- name across different customers is harmless, and a UNIQUE violation must
-- never be able to break the claim flow. The picker avoids collisions
-- best-effort.
-- ============================================================================

BEGIN;

ALTER TABLE public.engineer_profiles
  ADD COLUMN IF NOT EXISTS display_alias text;

CREATE INDEX IF NOT EXISTS idx_engineer_profiles_alias
  ON public.engineer_profiles (display_alias);

-- ── assign_engineer_alias ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_engineer_alias(_user uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Two short, globally-pronounceable token pools. Aliases are "First Last"
  -- (e.g. "Leo Hart") — reads as a natural (fake) name, satisfies Zoom's
  -- first+last-name requirement for registrants, and hides the real identity.
  -- Hand-picked so they're always sayable and never accidentally offensive.
  _first text[] := ARRAY[
    'Leo','Mia','Kai','Sam','Ana','Max','Noa','Theo','Nina','Omar',
    'Lena','Finn','Tara','Maya','Cole','Ivy','Jude','Sky','Zoe','Ravi',
    'Ada','Eli','Faye','Hana','Jai','Kira','Luca','Mira','Neel','Otto',
    'Pia','Remy','Sana','Tess','Uma','Vik','Wren','Yara','Zane','Arlo',
    'Bree','Cody','Dara','Esha','Gia','Hugo','Inez','Milo','Nora','Orin',
    'Rhea','Soren','Vera','Wade','Zara'
  ];
  _last text[] := ARRAY[
    'Hart','Vale','Ross','Lane','Kerr','Wood','Frost','Reed','Snow','Pike',
    'Hale','Vance','Marsh','Stone','Wells','Boyd','Cruz','Dunn','Ford','Gray',
    'Hayes','Kane','Lowe','Nash','Page','Rhodes','Shaw','Tate','Webb','Flynn'
  ];
  _existing  text;
  _candidate text;
  _try       int := 0;
BEGIN
  SELECT display_alias INTO _existing FROM engineer_profiles WHERE user_id = _user;
  IF _existing IS NOT NULL AND _existing <> '' THEN
    RETURN _existing;
  END IF;

  -- Generate "First Last" and retry until unused (huge combo space).
  WHILE _candidate IS NULL AND _try < 100 LOOP
    _candidate := _first[1 + floor(random() * array_length(_first, 1))::int]
                  || ' ' ||
                  _last[1 + floor(random() * array_length(_last, 1))::int];
    IF EXISTS (SELECT 1 FROM engineer_profiles WHERE display_alias = _candidate) THEN
      _candidate := NULL;
    END IF;
    _try := _try + 1;
  END LOOP;

  IF _candidate IS NULL THEN
    _candidate := 'Relay ' || left(_user::text, 4);
  END IF;

  UPDATE engineer_profiles SET display_alias = _candidate, updated_at = now()
   WHERE user_id = _user;

  RETURN _candidate;
END $$;

GRANT EXECUTE ON FUNCTION public.assign_engineer_alias(uuid) TO authenticated;

-- ── accept_match — write the ALIAS to the customer-facing name ───────────────
CREATE OR REPLACE FUNCTION public.accept_match(_offer_id uuid)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _offer    public.engineer_match_offers;
  _session  public.guest_calls;
  _engineer text;   -- real name (audit only)
  _alias    text;   -- customer-facing
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
  _alias := COALESCE(public.assign_engineer_alias(auth.uid()), _engineer, 'Engineer');
  SELECT pod_id INTO _pod
    FROM pod_members WHERE user_id = auth.uid() LIMIT 1;

  UPDATE guest_calls SET
    status      = 'assigned',
    claimed_by  = auth.uid(),
    claimed_at  = now(),
    assigned_at = now(),
    agent_name  = _alias,
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

  UPDATE engineer_match_offers
     SET status='expired', responded_at=now()
   WHERE intake_id = _offer.intake_id
     AND id <> _offer.id
     AND status = 'pending';

  -- Audit log keeps the REAL name for staff traceability.
  PERFORM _log_session_event(
    _session.id, 'session.claimed', 'queued', 'assigned',
    jsonb_build_object(
      'engineer_id',    auth.uid(),
      'engineer_name',  _engineer,
      'engineer_alias', _alias,
      'via',            'match_offer',
      'offer_id',       _offer.id
    )
  );

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session.id, 'system', 'Relay',
          format('👤 %s joined as engineer', _alias));

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.accept_match(uuid) TO authenticated;

-- ── supervisor_assign_engineer — same alias swap ────────────────────────────
CREATE OR REPLACE FUNCTION public.supervisor_assign_engineer(
  _intake_id        uuid,
  _engineer_user_id uuid
)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _caller        uuid := auth.uid();
  _intake        public.client_intakes;
  _session       public.guest_calls;
  _engineer_name text;   -- real (audit only)
  _alias         text;   -- customer-facing
  _pod           uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE='P0001';
  END IF;
  IF NOT public._can_manually_assign(_caller, _engineer_user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF NOT has_role(_engineer_user_id, 'engineer') THEN
    RAISE EXCEPTION 'NOT_AN_ENGINEER' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO _intake FROM client_intakes WHERE id = _intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTAKE_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF _intake.guest_call_id IS NULL THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM guest_calls
    WHERE claimed_by = _engineer_user_id
      AND status IN ('assigned','joining','live','grace','expired_free','ending')
  ) THEN
    RAISE EXCEPTION 'ENGINEER_BUSY' USING ERRCODE='P0001';
  END IF;

  SELECT COALESCE(NULLIF(full_name,''),'Engineer') INTO _engineer_name
    FROM profiles WHERE id = _engineer_user_id;
  _alias := COALESCE(public.assign_engineer_alias(_engineer_user_id), _engineer_name, 'Engineer');
  SELECT pod_id INTO _pod
    FROM pod_members WHERE user_id = _engineer_user_id LIMIT 1;

  UPDATE guest_calls SET
    status      = 'assigned',
    claimed_by  = _engineer_user_id,
    claimed_at  = now(),
    assigned_at = now(),
    agent_name  = _alias,
    pod_id      = _pod,
    updated_at  = now()
  WHERE id = _intake.guest_call_id
    AND status = 'queued'
  RETURNING * INTO _session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE='P0001';
  END IF;

  UPDATE engineer_match_offers
     SET status = 'accepted', responded_at = now()
   WHERE intake_id = _intake.id
     AND engineer_user_id = _engineer_user_id
     AND status = 'pending';
  IF NOT FOUND THEN
    INSERT INTO engineer_match_offers (
      intake_id, guest_call_id, engineer_user_id, customer_user_id,
      status, match_score, responded_at
    ) VALUES (
      _intake.id, _intake.guest_call_id, _engineer_user_id,
      _intake.customer_user_id, 'accepted', 0, now()
    );
  END IF;

  UPDATE engineer_match_offers
     SET status = 'expired', responded_at = now()
   WHERE intake_id = _intake.id
     AND status = 'pending'
     AND engineer_user_id <> _engineer_user_id;

  INSERT INTO supervisor_assignments
    (intake_id, guest_call_id, supervisor_user_id, assigned_engineer_id, action)
  VALUES
    (_intake.id, _intake.guest_call_id, _caller, _engineer_user_id, 'assign');

  PERFORM _log_session_event(
    _session.id, 'session.claimed', 'queued', 'assigned',
    jsonb_build_object(
      'engineer_id',    _engineer_user_id,
      'engineer_name',  _engineer_name,
      'engineer_alias', _alias,
      'via',            'supervisor_assign',
      'supervisor_id',  _caller
    )
  );

  INSERT INTO guest_messages (guest_call_id, sender_kind, sender_name, body)
  VALUES (_session.id, 'system', 'Relay',
          format('👤 %s was connected by your supervisor', _alias));

  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.supervisor_assign_engineer(uuid, uuid) TO authenticated;

-- ── Backfill: give every existing engineer an alias now ─────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT user_id FROM engineer_profiles
     WHERE display_alias IS NULL OR display_alias = ''
  LOOP
    PERFORM public.assign_engineer_alias(r.user_id);
  END LOOP;
END $$;

COMMIT;
