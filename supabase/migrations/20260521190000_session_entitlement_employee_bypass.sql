-- ============================================================================
-- get_or_create_active_customer_session: employee-aware entitlement gate
-- ============================================================================
-- Background: the function was last defined in 20260512130000 with an
-- entitlement gate that checks customer_entitlements (free + paid minutes).
-- After the 2026-05-20 enterprise-hierarchy reshape, employees draw from
-- profiles.remaining_minutes (sourced from the dept pool), NOT from
-- customer_entitlements. They typically don't have a customer_entitlements
-- row at all, OR they have one with free_consumed_at set + paid=0 — and
-- the old gate raises NO_ENTITLEMENT, which the UI's paywall-suppression
-- for employees now silently swallows. Net result: employee clicks
-- "Start session" → nothing happens.
--
-- Fix: branch the gate on profile.client_type. Employees must have
-- profiles.remaining_minutes > 0 to mint a new session; everyone else
-- keeps the existing free/paid gate. Both raise the same NO_ENTITLEMENT
-- error on failure so the client code path stays identical.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_or_create_active_customer_session(_project_id uuid DEFAULT NULL)
RETURNS public.guest_calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _u             auth.users%ROWTYPE;
  _name          text;
  _email         text;
  _thread        uuid;
  _session       public.guest_calls;
  _ent           public.customer_entitlements;
  _proj_name     text;
  _is_employee   boolean := false;
  _emp_remaining numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('relay-cust-session:' || auth.uid()::text, 0));

  -- Return existing active session if present.
  SELECT * INTO _session
    FROM guest_calls
    WHERE customer_user_id = auth.uid()
      AND status NOT IN ('ended','abandoned','cancelled')
    ORDER BY created_at DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN _session;
  END IF;

  -- Entitlement gate before creating a NEW row.
  -- Employees route through the dept pool (profiles.remaining_minutes).
  -- Everyone else uses the legacy customer_entitlements (free + paid).
  SELECT client_type = 'employee', COALESCE(remaining_minutes, 0)
    INTO _is_employee, _emp_remaining
    FROM profiles
   WHERE id = auth.uid();

  IF _is_employee THEN
    IF _emp_remaining <= 0 THEN
      RAISE EXCEPTION 'NO_ENTITLEMENT' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO _ent FROM customer_entitlements WHERE customer_user_id = auth.uid();
    IF FOUND THEN
      IF _ent.free_session_consumed_at IS NOT NULL AND _ent.paid_minutes_remaining <= 0 THEN
        RAISE EXCEPTION 'NO_ENTITLEMENT' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  SELECT * INTO _u FROM auth.users WHERE id = auth.uid();
  _email := _u.email;
  _name  := COALESCE(NULLIF(_u.raw_user_meta_data->>'full_name',''),
                     split_part(_u.email,'@',1));

  SELECT public.find_or_create_guest_thread(_email, NULL, _name) INTO _thread;

  -- Seed a customer_entitlements row for non-employees so downstream
  -- consumption / paywall logic has a deterministic target. Employees
  -- never write to this table — their balance lives on profiles.
  IF NOT _is_employee THEN
    INSERT INTO customer_entitlements (customer_user_id) VALUES (auth.uid())
      ON CONFLICT DO NOTHING;
  END IF;

  -- Resolve project name from id, but only for projects the caller owns —
  -- a stranger's id is ignored (treated as no project).
  IF _project_id IS NOT NULL THEN
    SELECT name INTO _proj_name
      FROM projects
      WHERE id = _project_id AND customer_id = auth.uid();
  END IF;

  INSERT INTO guest_calls (
    guest_name, guest_email, status, thread_id,
    customer_user_id, free_minutes,
    project_id, project_name
  ) VALUES (
    _name, _email, 'queued', _thread,
    auth.uid(), 10,
    CASE WHEN _proj_name IS NOT NULL THEN _project_id ELSE NULL END,
    _proj_name
  ) RETURNING * INTO _session;

  PERFORM _log_session_event(_session.id, 'session.created', NULL, 'queued', NULL);
  RETURN _session;
END $$;

GRANT EXECUTE ON FUNCTION public.get_or_create_active_customer_session(uuid) TO authenticated;

COMMIT;
