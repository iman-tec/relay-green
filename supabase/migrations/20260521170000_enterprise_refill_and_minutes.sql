-- ============================================================================
-- Enterprise refill: minutes columns, spec-format codes, OTP table,
-- tier-transfer + deactivation RPCs.
-- ============================================================================
-- Builds on 20260521130000_enterprise_hierarchy.sql.
--
-- Adds:
--   * resellers:       email, commission, allocated_minutes,
--                      used_minutes, remaining_minutes
--   * organizations:   enterprise_type, allocated_minutes,
--                      used_minutes, remaining_minutes
--   * departments:     allocated_minutes, used_minutes, remaining_minutes
--   * profiles:        client_type, allocated_minutes, used_minutes,
--                      remaining_minutes, status
--
-- Code format (spec):
--   * resellers.reseller_code        → RLC-AB12CD   (2A 2D 2A)
--   * departments.department_code    → DLC-AB12CD   (2A 2D 2A)
--   organizations.enterprise_code keeps its existing slug-based format
--   from gen_org_code() so we don't churn existing data.
--
-- Hybrid first-login flow needs:
--   * otp_codes — 6-digit codes with expiry and attempt counter
--
-- Transfer RPCs (atomic parent→child, balance-validated):
--   * transfer_to_reseller, transfer_to_organization,
--     transfer_to_department, transfer_to_employee
--
-- Deactivation RPCs (per spec cascades + balance returns):
--   * deactivate_employee, deactivate_department,
--     deactivate_enterprise (freeze, no upward refund),
--     deactivate_reseller (converts inorganic enterprises → organic)
-- ============================================================================

BEGIN;

-- ── 1. Minutes / status / type columns ────────────────────────────────────

-- Resellers
ALTER TABLE public.resellers
  ADD COLUMN IF NOT EXISTS email              text,
  ADD COLUMN IF NOT EXISTS commission         numeric(6,2) NOT NULL DEFAULT 0
                            CHECK (commission >= 0 AND commission <= 100),
  ADD COLUMN IF NOT EXISTS allocated_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (allocated_minutes >= 0),
  ADD COLUMN IF NOT EXISTS used_minutes       numeric NOT NULL DEFAULT 0
                            CHECK (used_minutes >= 0),
  ADD COLUMN IF NOT EXISTS remaining_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (remaining_minutes >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resellers_email_unique
  ON public.resellers(lower(email)) WHERE email IS NOT NULL;

-- Organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enterprise_type    text NOT NULL DEFAULT 'organic'
                            CHECK (enterprise_type IN ('organic', 'inorganic')),
  ADD COLUMN IF NOT EXISTS allocated_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (allocated_minutes >= 0),
  ADD COLUMN IF NOT EXISTS used_minutes       numeric NOT NULL DEFAULT 0
                            CHECK (used_minutes >= 0),
  ADD COLUMN IF NOT EXISTS remaining_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (remaining_minutes >= 0);

-- Backfill: any rows already linked to a reseller become inorganic.
UPDATE public.organizations
   SET enterprise_type = 'inorganic'
 WHERE reseller_id IS NOT NULL
   AND enterprise_type <> 'inorganic';

-- Type ↔ reseller_id coherence guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name   = 'organizations'
       AND constraint_name = 'organizations_type_reseller_coherence'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_type_reseller_coherence
      CHECK (
        (enterprise_type = 'inorganic' AND reseller_id IS NOT NULL)
        OR (enterprise_type = 'organic'   AND reseller_id IS NULL)
      );
  END IF;
END
$$;

-- Departments
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS allocated_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (allocated_minutes >= 0),
  ADD COLUMN IF NOT EXISTS used_minutes       numeric NOT NULL DEFAULT 0
                            CHECK (used_minutes >= 0),
  ADD COLUMN IF NOT EXISTS remaining_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (remaining_minutes >= 0);

-- Profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS client_type        text NOT NULL DEFAULT 'client'
                            CHECK (client_type IN ('client', 'employee')),
  ADD COLUMN IF NOT EXISTS allocated_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (allocated_minutes >= 0),
  ADD COLUMN IF NOT EXISTS used_minutes       numeric NOT NULL DEFAULT 0
                            CHECK (used_minutes >= 0),
  ADD COLUMN IF NOT EXISTS remaining_minutes  numeric NOT NULL DEFAULT 0
                            CHECK (remaining_minutes >= 0),
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended'));

-- Backfill: profiles attached to a department are employees.
UPDATE public.profiles
   SET client_type = 'employee'
 WHERE department_id IS NOT NULL
   AND client_type <> 'employee';

CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- ── 2. Spec-format code generators (RLC- / DLC-) ──────────────────────────

CREATE OR REPLACE FUNCTION public.gen_xx_nn_xx_code(_prefix text)
RETURNS text
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  _alpha text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  _num   text := '0123456789';
  _out   text;
BEGIN
  _out := _prefix || '-';
  _out := _out || substr(_alpha, 1 + floor(random() * 26)::int, 1);
  _out := _out || substr(_alpha, 1 + floor(random() * 26)::int, 1);
  _out := _out || substr(_num,   1 + floor(random() * 10)::int, 1);
  _out := _out || substr(_num,   1 + floor(random() * 10)::int, 1);
  _out := _out || substr(_alpha, 1 + floor(random() * 26)::int, 1);
  _out := _out || substr(_alpha, 1 + floor(random() * 26)::int, 1);
  RETURN _out;
END $$;

-- Replace reseller trigger to use RLC- format.
CREATE OR REPLACE FUNCTION public.resellers_set_code()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE _try int := 0;
BEGIN
  IF NEW.reseller_code IS NULL OR NEW.reseller_code = '' THEN
    LOOP
      NEW.reseller_code := public.gen_xx_nn_xx_code('RLC');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.resellers
         WHERE reseller_code = NEW.reseller_code AND id <> NEW.id
      );
      _try := _try + 1;
      IF _try > 20 THEN
        RAISE EXCEPTION 'reseller_code generation exhausted retries';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

-- Replace department trigger to use DLC- format.
CREATE OR REPLACE FUNCTION public.departments_set_code()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE _try int := 0;
BEGIN
  IF NEW.department_code IS NULL OR NEW.department_code = '' THEN
    LOOP
      NEW.department_code := public.gen_xx_nn_xx_code('DLC');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.departments
         WHERE department_code = NEW.department_code AND id <> NEW.id
      );
      _try := _try + 1;
      IF _try > 20 THEN
        RAISE EXCEPTION 'department_code generation exhausted retries';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

-- Backfill: regenerate any pre-existing codes to spec format (triggers above
-- only fire on INSERT).
DO $$
DECLARE
  r record;
  _new text;
  _try int;
BEGIN
  FOR r IN SELECT id FROM public.resellers WHERE reseller_code NOT LIKE 'RLC-%' LOOP
    _try := 0;
    LOOP
      _new := public.gen_xx_nn_xx_code('RLC');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.resellers WHERE reseller_code = _new AND id <> r.id
      );
      _try := _try + 1;
      IF _try > 20 THEN RAISE EXCEPTION 'reseller_code backfill exhausted'; END IF;
    END LOOP;
    UPDATE public.resellers SET reseller_code = _new WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id FROM public.departments WHERE department_code NOT LIKE 'DLC-%' LOOP
    _try := 0;
    LOOP
      _new := public.gen_xx_nn_xx_code('DLC');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.departments WHERE department_code = _new AND id <> r.id
      );
      _try := _try + 1;
      IF _try > 20 THEN RAISE EXCEPTION 'department_code backfill exhausted'; END IF;
    END LOOP;
    UPDATE public.departments SET department_code = _new WHERE id = r.id;
  END LOOP;
END $$;

-- ── 3. otp_codes (hybrid first-login flow) ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otp_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  purpose     text        NOT NULL CHECK (purpose IN ('first_login', 'password_reset')),
  code        text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int         NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_email_purpose
  ON public.otp_codes(lower(email), purpose, expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user
  ON public.otp_codes(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Deny all direct access; only service_role (bypasses RLS) may read/write.
DROP POLICY IF EXISTS otp_codes_no_direct_access ON public.otp_codes;
CREATE POLICY otp_codes_no_direct_access
  ON public.otp_codes FOR ALL
  USING (false)
  WITH CHECK (false);

-- ── 4. Transfer RPCs (atomic parent→child) ────────────────────────────────

-- Reseller pool credit (from implicit superadmin pool — no parent debit).
CREATE OR REPLACE FUNCTION public.transfer_to_reseller(
  _reseller_id uuid,
  _amount      numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  UPDATE public.resellers
     SET allocated_minutes = allocated_minutes + _amount,
         remaining_minutes = remaining_minutes + _amount
   WHERE id = _reseller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reseller not found: %', _reseller_id;
  END IF;
END $$;

-- Organization credit: debit reseller if inorganic, else credit from superadmin.
CREATE OR REPLACE FUNCTION public.transfer_to_organization(
  _org_id uuid,
  _amount numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _r_id uuid;
  _type text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT reseller_id, enterprise_type
    INTO _r_id, _type
    FROM public.organizations
   WHERE id = _org_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', _org_id;
  END IF;

  IF _type = 'inorganic' THEN
    PERFORM 1 FROM public.resellers
      WHERE id = _r_id AND remaining_minutes >= _amount
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reseller has insufficient remaining_minutes';
    END IF;

    UPDATE public.resellers
       SET remaining_minutes = remaining_minutes - _amount
     WHERE id = _r_id;
  END IF;

  UPDATE public.organizations
     SET allocated_minutes = allocated_minutes + _amount,
         remaining_minutes = remaining_minutes + _amount
   WHERE id = _org_id;
END $$;

-- Department credit from enterprise.
CREATE OR REPLACE FUNCTION public.transfer_to_department(
  _dept_id uuid,
  _amount  numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _org_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT enterprise_id INTO _org_id
    FROM public.departments
   WHERE id = _dept_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'department not found: %', _dept_id;
  END IF;

  PERFORM 1 FROM public.organizations
    WHERE id = _org_id AND remaining_minutes >= _amount
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enterprise has insufficient remaining_minutes';
  END IF;

  UPDATE public.organizations
     SET remaining_minutes = remaining_minutes - _amount
   WHERE id = _org_id;

  UPDATE public.departments
     SET allocated_minutes = allocated_minutes + _amount,
         remaining_minutes = remaining_minutes + _amount
   WHERE id = _dept_id;
END $$;

-- Employee credit from department.
CREATE OR REPLACE FUNCTION public.transfer_to_employee(
  _profile_id uuid,
  _amount     numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _dept_id uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT department_id INTO _dept_id
    FROM public.profiles
   WHERE id = _profile_id
   FOR UPDATE;

  IF _dept_id IS NULL THEN
    RAISE EXCEPTION 'profile has no department: %', _profile_id;
  END IF;

  PERFORM 1 FROM public.departments
    WHERE id = _dept_id AND remaining_minutes >= _amount
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'department has insufficient remaining_minutes';
  END IF;

  UPDATE public.departments
     SET remaining_minutes = remaining_minutes - _amount
   WHERE id = _dept_id;

  UPDATE public.profiles
     SET allocated_minutes = allocated_minutes + _amount,
         remaining_minutes = remaining_minutes + _amount
   WHERE id = _profile_id;
END $$;

GRANT EXECUTE ON FUNCTION public.transfer_to_reseller(uuid, numeric)     TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_to_organization(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_to_department(uuid, numeric)   TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_to_employee(uuid, numeric)     TO service_role;

-- ── 5. Deactivation RPCs ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.deactivate_employee(_profile_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _dept_id uuid;
  _remain  numeric;
BEGIN
  SELECT department_id, remaining_minutes
    INTO _dept_id, _remain
    FROM public.profiles
   WHERE id = _profile_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found: %', _profile_id;
  END IF;

  IF _dept_id IS NOT NULL AND _remain > 0 THEN
    UPDATE public.departments
       SET remaining_minutes = remaining_minutes + _remain
     WHERE id = _dept_id;
  END IF;

  UPDATE public.profiles
     SET status            = 'suspended',
         remaining_minutes = 0
   WHERE id = _profile_id;
END $$;

CREATE OR REPLACE FUNCTION public.deactivate_department(_dept_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _emp     record;
  _org_id  uuid;
  _remain  numeric;
BEGIN
  -- Cascade through active employees first so their balances flow back.
  FOR _emp IN
    SELECT id FROM public.profiles
     WHERE department_id = _dept_id AND status = 'active'
  LOOP
    PERFORM public.deactivate_employee(_emp.id);
  END LOOP;

  SELECT enterprise_id, remaining_minutes
    INTO _org_id, _remain
    FROM public.departments
   WHERE id = _dept_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'department not found: %', _dept_id;
  END IF;

  IF _org_id IS NOT NULL AND _remain > 0 THEN
    UPDATE public.organizations
       SET remaining_minutes = remaining_minutes + _remain
     WHERE id = _org_id;
  END IF;

  UPDATE public.departments
     SET status            = 'suspended',
         remaining_minutes = 0
   WHERE id = _dept_id;
END $$;

-- Enterprise: freeze only — spec explicitly forbids upward refund.
CREATE OR REPLACE FUNCTION public.deactivate_enterprise(_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.organizations
     SET status = 'suspended'
   WHERE id = _org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', _org_id;
  END IF;
END $$;

-- Reseller: convert all inorganic enterprises to organic; preserve data.
CREATE OR REPLACE FUNCTION public.deactivate_reseller(_reseller_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- reseller_id → NULL and enterprise_type → 'organic' in the same UPDATE so
  -- the coherence constraint stays satisfied.
  UPDATE public.organizations
     SET reseller_id     = NULL,
         enterprise_type = 'organic'
   WHERE reseller_id = _reseller_id;

  UPDATE public.resellers
     SET status = 'suspended'
   WHERE id = _reseller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reseller not found: %', _reseller_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.deactivate_employee(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_department(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_enterprise(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_reseller(uuid)   TO service_role;

COMMIT;
