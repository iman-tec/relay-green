-- ============================================================================
--  DEMO SEED  —  Gaute customer + Madhav super-admin + full reseller hierarchy
-- ============================================================================
--  Idempotent & additive. Safe to run multiple times; re-running re-asserts the
--  same deterministic values and never duplicates rows. It ONLY writes the rows
--  it creates (everything is keyed by email / id), so existing live data is
--  left intact.
--
--  HOW TO RUN
--    • Supabase SQL editor: paste this whole file and Run, OR
--    • CLI / migration flow: it lives in supabase/migrations and applies like
--      any other migration.
--    (Runs as the privileged `postgres` role — required to write auth.users.)
--
--  WHAT IT CREATES
--    1. Super admin   madhav.anadkat@thegatewaycorp.co.in   (verified + password)
--    2. Customer      gaute.green@thegatewaycorp.com         (verified + password)
--                     → 200 paid minutes, free 10-min lock disabled
--    3. Hierarchy     5 resellers
--                       × 5 enterprises (inorganic, under the reseller)
--                         × 5 departments
--                           × 5 members  (employees, draw from dept pool)
--                     = 5 / 25 / 125 / 625 rows respectively, each with its own
--                       login. Minutes allocated top-down; every member's
--                       used-minutes value is globally unique; usage rolls up to
--                       department → enterprise → reseller; commission = 10%.
--
--  CREDENTIALS  (all accounts are email-confirmed with a real password)
--    Super admin   madhav.anadkat@thegatewaycorp.co.in   /  Madhav@Relay2026
--    Customer      gaute.green@thegatewaycorp.com         /  Gaute@Relay2026
--    Reseller i    resellerNN@relay.demo                  /  RelayDemo@2026
--    Ent admin     rNNeMM-admin@relay.demo                /  RelayDemo@2026
--    Dept admin    rNNeMMdKK-admin@relay.demo             /  RelayDemo@2026
--    Member        rNNeMMdKKmPP@relay.demo                /  RelayDemo@2026
--
--  TO REMOVE LATER: delete every auth.users row whose email ends in
--  '@relay.demo' (profiles/resellers/orgs/depts cascade or detach via FK),
--  plus the two named accounts above. Or just delete this migration file if you
--  never want it re-applied on a fresh `db reset`.
-- ============================================================================

BEGIN;

-- pgcrypto gives us crypt()/gen_salt() for bcrypt password hashing. On Supabase
-- it normally lives in the `extensions` schema; the helper below puts both
-- public and extensions on its search_path so it resolves either way.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Helper: create (or reuse) a verified, password-enabled auth user ─────────
-- Returns the user id. Idempotent: if the email already exists, returns it
-- untouched. On create it builds the auth.users row the way Supabase's Auth
-- Admin API would (email_confirm + provider=email + password_set flag) and the
-- matching auth.identities row so password sign-in works. The existing
-- on_auth_user_created trigger auto-creates the public.profiles row.
CREATE OR REPLACE FUNCTION public._seed_user(
  _email     text,
  _password  text,
  _full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, extensions, auth
AS $fn$
DECLARE
  _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email);
  IF _uid IS NOT NULL THEN
    RETURN _uid;
  END IF;

  _uid := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated', lower(_email),
    crypt(_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'password_set', true),
    jsonb_build_object('full_name', _full_name, 'display_name', _full_name, 'email_verified', true),
    now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), _uid, _uid::text,
    jsonb_build_object('sub', _uid::text, 'email', lower(_email), 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  RETURN _uid;
END;
$fn$;

-- ── Main seed ────────────────────────────────────────────────────────────────
DO $seed$
DECLARE
  BULK_PW    constant text := 'RelayDemo@2026';

  -- role ids
  rid_super     uuid;
  rid_reseller  uuid;
  rid_entadmin  uuid;
  rid_deptadmin uuid;
  rid_client    uuid;

  -- working ids
  uid_madhav uuid;
  uid_gaute  uuid;
  uid_owner  uuid;
  uid_eadm   uuid;
  uid_dadm   uuid;
  uid_member uuid;
  res_id     uuid;
  org_id     uuid;
  dept_id    uuid;

  -- loop counters / names
  i int; j int; k int; m int;
  g int := 0;                       -- global member counter → unique used-minutes
  res_name text; res_email text;
  org_name text;
  dept_name text; dept_email text;
  mem_email text; mem_name text;

  -- minutes
  mem_alloc  numeric; mem_used numeric;
  dept_sum   numeric;
  ent_sum    numeric;
  res_sum    numeric;
BEGIN
  SELECT id INTO rid_super     FROM public.roles WHERE name = 'super_admin';
  SELECT id INTO rid_reseller  FROM public.roles WHERE name = 'reseller';
  SELECT id INTO rid_entadmin  FROM public.roles WHERE name = 'enterprise_admin';
  SELECT id INTO rid_deptadmin FROM public.roles WHERE name = 'department_admin';
  SELECT id INTO rid_client    FROM public.roles WHERE name = 'client';

  IF rid_super IS NULL OR rid_reseller IS NULL OR rid_entadmin IS NULL
     OR rid_deptadmin IS NULL OR rid_client IS NULL THEN
    RAISE EXCEPTION 'roles lookup is missing expected rows — apply roles migrations first';
  END IF;

  -- ── 1. Super admin: Madhav ─────────────────────────────────────────────────
  uid_madhav := public._seed_user('madhav.anadkat@thegatewaycorp.co.in', 'Madhav@Relay2026', 'Madhav Anadkat');
  INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded)
       VALUES (uid_madhav, 'Madhav Anadkat', rid_super, true)
  ON CONFLICT (id) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         primary_role_id = EXCLUDED.primary_role_id,
         is_onboarded = true;
  INSERT INTO public.user_roles (user_id, role_id)
       VALUES (uid_madhav, rid_super)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  -- ── 2. Customer: Gaute (organic, free-lock disabled, 200 paid minutes) ──────
  uid_gaute := public._seed_user('gaute.green@thegatewaycorp.com', 'Gaute@Relay2026', 'Gaute Green');
  INSERT INTO public.profiles (id, full_name, is_onboarded, client_type)
       VALUES (uid_gaute, 'Gaute Green', true, 'client')
  ON CONFLICT (id) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         is_onboarded = true;
  INSERT INTO public.customer_entitlements (customer_user_id, paid_minutes_remaining, free_session_consumed_at)
       VALUES (uid_gaute, 200, NULL)
  ON CONFLICT (customer_user_id) DO UPDATE
     SET paid_minutes_remaining = 200,
         free_session_consumed_at = NULL;

  -- ── 3. Reseller → Enterprise → Department → Member hierarchy ────────────────
  FOR i IN 1..5 LOOP
    res_name  := 'Reseller ' || lpad(i::text, 2, '0');
    res_email := 'reseller' || lpad(i::text, 2, '0') || '@relay.demo';

    uid_owner := public._seed_user(res_email, BULK_PW, res_name || ' Owner');
    INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded)
         VALUES (uid_owner, res_name || ' Owner', rid_reseller, true)
    ON CONFLICT (id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           primary_role_id = EXCLUDED.primary_role_id,
           is_onboarded = true;
    INSERT INTO public.user_roles (user_id, role_id)
         VALUES (uid_owner, rid_reseller)
    ON CONFLICT (user_id, role_id) DO NOTHING;

    SELECT id INTO res_id FROM public.resellers WHERE lower(email) = lower(res_email);
    IF res_id IS NULL THEN
      INSERT INTO public.resellers (name, email, commission, status, owner_user_id, created_by_user_id)
           VALUES (res_name, res_email, 10, 'active', uid_owner, uid_madhav)
        RETURNING id INTO res_id;
    END IF;
    UPDATE public.profiles SET reseller_id = res_id WHERE id = uid_owner;

    res_sum := 0;

    FOR j IN 1..5 LOOP
      org_name := 'R' || lpad(i::text,2,'0') || ' Enterprise ' || lpad(j::text,2,'0');

      SELECT id INTO org_id
        FROM public.organizations
       WHERE name = org_name AND reseller_id = res_id;
      IF org_id IS NULL THEN
        INSERT INTO public.organizations (name, status, enterprise_type, reseller_id, created_by_user_id)
             VALUES (org_name, 'active', 'inorganic', res_id, uid_madhav)
          RETURNING id INTO org_id;
      END IF;

      -- enterprise admin
      uid_eadm := public._seed_user(
        'r' || lpad(i::text,2,'0') || 'e' || lpad(j::text,2,'0') || '-admin@relay.demo',
        BULK_PW, org_name || ' Admin');
      INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded, organization_id)
           VALUES (uid_eadm, org_name || ' Admin', rid_entadmin, true, org_id)
      ON CONFLICT (id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             primary_role_id = EXCLUDED.primary_role_id,
             is_onboarded = true,
             organization_id = EXCLUDED.organization_id;
      INSERT INTO public.user_roles (user_id, role_id)
           VALUES (uid_eadm, rid_entadmin)
      ON CONFLICT (user_id, role_id) DO NOTHING;

      ent_sum := 0;

      FOR k IN 1..5 LOOP
        dept_name  := 'R' || lpad(i::text,2,'0') || 'E' || lpad(j::text,2,'0') || ' Dept ' || lpad(k::text,2,'0');
        dept_email := 'r' || lpad(i::text,2,'0') || 'e' || lpad(j::text,2,'0') || 'd' || lpad(k::text,2,'0') || '-admin@relay.demo';

        -- department admin
        uid_dadm := public._seed_user(dept_email, BULK_PW, dept_name || ' Admin');

        SELECT id INTO dept_id
          FROM public.departments
         WHERE enterprise_id = org_id AND name = dept_name;
        IF dept_id IS NULL THEN
          INSERT INTO public.departments (enterprise_id, name, admin_user_id, status, created_by_user_id)
               VALUES (org_id, dept_name, uid_dadm, 'active', uid_madhav)
            RETURNING id INTO dept_id;
        ELSE
          UPDATE public.departments SET admin_user_id = uid_dadm WHERE id = dept_id;
        END IF;

        INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded, organization_id, department_id, client_type)
             VALUES (uid_dadm, dept_name || ' Admin', rid_deptadmin, true, org_id, dept_id, 'client')
        ON CONFLICT (id) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               primary_role_id = EXCLUDED.primary_role_id,
               is_onboarded = true,
               organization_id = EXCLUDED.organization_id,
               department_id = EXCLUDED.department_id;
        INSERT INTO public.user_roles (user_id, role_id)
             VALUES (uid_dadm, rid_deptadmin)
        ON CONFLICT (user_id, role_id) DO NOTHING;

        dept_sum := 0;

        FOR m IN 1..5 LOOP
          g := g + 1;                       -- global, ensures uniqueness everywhere
          mem_used  := 30 + g;              -- unique: 31 .. 655
          mem_alloc := 600 + 2 * g;         -- unique: 602 .. 1850  (always > mem_used)

          mem_email := 'r' || lpad(i::text,2,'0') || 'e' || lpad(j::text,2,'0')
                    || 'd' || lpad(k::text,2,'0') || 'm' || lpad(m::text,2,'0') || '@relay.demo';
          mem_name  := 'Member ' || lpad(i::text,2,'0') || '-' || lpad(j::text,2,'0')
                    || '-' || lpad(k::text,2,'0') || '-' || lpad(m::text,2,'0');

          uid_member := public._seed_user(mem_email, BULK_PW, mem_name);
          INSERT INTO public.profiles (
            id, full_name, primary_role_id, is_onboarded,
            organization_id, department_id, client_type, status,
            allocated_minutes, used_minutes, remaining_minutes
          ) VALUES (
            uid_member, mem_name, rid_client, true,
            org_id, dept_id, 'employee', 'active',
            mem_alloc, mem_used, mem_alloc - mem_used
          )
          ON CONFLICT (id) DO UPDATE
             SET full_name = EXCLUDED.full_name,
                 primary_role_id = EXCLUDED.primary_role_id,
                 is_onboarded = true,
                 organization_id = EXCLUDED.organization_id,
                 department_id = EXCLUDED.department_id,
                 client_type = 'employee',
                 status = 'active',
                 allocated_minutes = EXCLUDED.allocated_minutes,
                 used_minutes = EXCLUDED.used_minutes,
                 remaining_minutes = EXCLUDED.remaining_minutes;
          INSERT INTO public.user_roles (user_id, role_id)
               VALUES (uid_member, rid_client)
          ON CONFLICT (user_id, role_id) DO NOTHING;

          dept_sum := dept_sum + mem_used;
        END LOOP;  -- members

        -- department roll-up (flat 5,000 pool; usage = Σ its members)
        UPDATE public.departments
           SET allocated_minutes = 5000,
               used_minutes      = dept_sum,
               remaining_minutes = 5000 - dept_sum
         WHERE id = dept_id;

        ent_sum := ent_sum + dept_sum;
      END LOOP;  -- departments

      -- enterprise roll-up (flat 30,000 pool; usage = Σ its departments)
      UPDATE public.organizations
         SET allocated_minutes = 30000,
             used_minutes      = ent_sum,
             remaining_minutes = 30000 - ent_sum
       WHERE id = org_id;

      res_sum := res_sum + ent_sum;
    END LOOP;  -- enterprises

    -- reseller roll-up (flat 200,000 pool; usage = Σ its enterprises) + 10% share
    UPDATE public.resellers
       SET allocated_minutes = 200000,
           used_minutes      = res_sum,
           remaining_minutes = 200000 - res_sum,
           commission        = 10
     WHERE id = res_id;
  END LOOP;  -- resellers

  RAISE NOTICE 'Demo seed complete: 1 super-admin, 1 customer, 5 resellers, 25 enterprises, 125 departments, % members.', g;
END;
$seed$;

-- Tidy up the one-shot helper.
DROP FUNCTION IF EXISTS public._seed_user(text, text, text);

COMMIT;

-- ── Post-run sanity check (shows in the SQL editor results pane) ──────────────
SELECT
  (SELECT count(*) FROM public.resellers    WHERE email LIKE '%@relay.demo')                       AS resellers,
  (SELECT count(*) FROM public.organizations WHERE name LIKE 'R% Enterprise %')                     AS enterprises,
  (SELECT count(*) FROM public.departments   WHERE name LIKE 'R%E% Dept %')                         AS departments,
  (SELECT count(*) FROM public.profiles      WHERE client_type = 'employee' AND full_name LIKE 'Member %') AS members,
  (SELECT count(DISTINCT used_minutes) FROM public.profiles WHERE full_name LIKE 'Member %')        AS distinct_used_values;
