-- ============================================================================
--  EPICENTER  —  new channel partner + 5 named enterprises + departments + employees
-- ============================================================================
--  Additive & idempotent. Creates verified, password-enabled accounts wired up
--  through the full hierarchy:
--
--    Channel partner  Epicenter
--      ├─ Virta            (Smart EV charging platform)
--      ├─ Heartspace AI    (Workspace & knowledge AI)
--      ├─ Agent One        (Software & digital innovation)
--      ├─ Einride          (Autonomous & electric freight — Alumni)
--      └─ Wndy             (HR platform & digital workspace)
--    each enterprise → 5 departments (Engineering, Finance, Sales,
--                       Customer Support, Operations)
--    each department → 2 employees (real persona names) with minutes + usage
--
--  Minutes follow the same scheme as the main seed (pools roll up: reseller
--  200k, enterprise 30k, department 5k; employees draw from the dept pool).
--
--  KEY DEMO LOGINS (all verified, password already set — sign in directly):
--    Channel partner (Epicenter)            epicenter@relay.demo   / Epicenter@2026
--    Enterprise (Virta) admin               virta@relay.demo       / Virta@2026
--    Department (Virta · Engineering) admin eng@relay.demo         / Eng@2026
--    Employee (Virta · Engineering)         emp@relay.demo         / Emp@2026
--  All other Epicenter accounts share the password: Epicenter@2026
--    (other enterprise admins: heartspace@ / agentone@ / einride@ / wndy@ @relay.demo)
--    (other dept admins:  <ent>.<dept>@relay.demo, e.g. virta.fin@relay.demo)
--    (other employees:    <ent>.<dept>.e<n>@relay.demo)
--
--  HOW TO RUN: paste this whole file into the Supabase SQL editor and Run.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Same helper as the main seed: create-or-return a verified, password-enabled
-- auth user (+ matching identity). Dropped at the end.
CREATE OR REPLACE FUNCTION public._seed_user(_email text, _password text, _full_name text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, extensions, auth
AS $fn$
DECLARE _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email);
  IF _uid IS NOT NULL THEN RETURN _uid; END IF;

  _uid := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
    lower(_email), crypt(_password, gen_salt('bf')), now(),
    jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'password_set',true),
    jsonb_build_object('full_name',_full_name,'display_name',_full_name,'email_verified',true),
    now(), now(), '', '', '', ''
  );
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), _uid, _uid::text,
    jsonb_build_object('sub',_uid::text,'email',lower(_email),'email_verified',true,'phone_verified',false),
    'email', now(), now(), now()
  );
  RETURN _uid;
END $fn$;

DO $epi$
DECLARE
  rid_reseller  uuid;
  rid_entadmin  uuid;
  rid_deptadmin uuid;
  rid_client    uuid;

  firsts text[] := ARRAY[
    'Aarav','Olivia','Liam','Sofia','Noah','Emma','Arjun','Mia','Lucas','Ava',
    'Mateo','Isla','Ethan','Aria','Kai','Zara','Leo','Chloe','Ravi','Maya',
    'Felix','Nora','Omar','Ines','Hugo','Lena','Diego','Priya','Marco','Yuki',
    'Ivan','Amara','Theo','Hana','Sven','Lucia','Tariq','Freya','Niko','Anaya'];
  lasts text[] := ARRAY[
    'Sharma','Andersen','Okafor','Rossi','Nguyen','Kim','Patel','Muller','Silva','Johansson',
    'Haddad','Tanaka','Novak','Costa','Ivanov','Mehta','Bauer','Lindqvist','Reyes','Khan',
    'Dubois','Romano','Walsh','Cohen','Mbeki','Park','Singh','Larsen','Moreau','Fernandes',
    'Volkov','Iyer','Schneider','Bianchi','Owusu','Sato','Kowalski','Berg','Acosta','Rao'];

  ent_names  text[] := ARRAY['Virta','Heartspace AI','Agent One','Einride','Wndy'];
  ent_slugs  text[] := ARRAY['virta','heartspace','agentone','einride','wndy'];
  dept_names text[] := ARRAY['Engineering','Finance','Sales','Customer Support','Operations'];
  dept_slugs text[] := ARRAY['eng','fin','sales','support','ops'];

  EMP_PER_DEPT constant int  := 2;
  BULK_PW      constant text := 'Epicenter@2026';

  res_id uuid; owner_id uuid; org_id uuid; eadm_id uuid; dept_id uuid; dadm_id uuid; emp_id uuid;
  i int; k int; m int; g int := 0; pair int;
  ent_slug text; dept_slug text;
  eadm_email text; eadm_pw text; dadm_email text; dadm_pw text;
  emp_email text; emp_pw text; emp_name text;
  dept_used numeric; ent_used numeric; res_used numeric;
  emp_alloc numeric; emp_used numeric;
BEGIN
  SELECT id INTO rid_reseller  FROM public.roles WHERE name='reseller';
  SELECT id INTO rid_entadmin  FROM public.roles WHERE name='enterprise_admin';
  SELECT id INTO rid_deptadmin FROM public.roles WHERE name='department_admin';
  SELECT id INTO rid_client    FROM public.roles WHERE name='client';

  -- ── Channel partner: Epicenter + owner ──────────────────────────────────
  owner_id := public._seed_user('epicenter@relay.demo','Epicenter@2026','Epicenter Admin');
  INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded)
       VALUES (owner_id,'Epicenter Admin',rid_reseller,true)
  ON CONFLICT (id) DO UPDATE
     SET full_name=EXCLUDED.full_name, primary_role_id=EXCLUDED.primary_role_id, is_onboarded=true;
  INSERT INTO public.user_roles (user_id,role_id) VALUES (owner_id,rid_reseller)
  ON CONFLICT (user_id,role_id) DO NOTHING;

  SELECT id INTO res_id FROM public.resellers WHERE lower(email)='epicenter@relay.demo';
  IF res_id IS NULL THEN
    INSERT INTO public.resellers (name,email,commission,status,owner_user_id,created_by_user_id)
         VALUES ('Epicenter','epicenter@relay.demo',10,'active',owner_id,owner_id)
      RETURNING id INTO res_id;
  END IF;
  UPDATE public.profiles SET reseller_id=res_id WHERE id=owner_id;

  res_used := 0;

  FOR i IN 1..array_length(ent_names,1) LOOP
    ent_slug   := ent_slugs[i];
    eadm_email := ent_slug || '@relay.demo';
    eadm_pw    := CASE WHEN ent_slug='virta' THEN 'Virta@2026' ELSE BULK_PW END;

    SELECT id INTO org_id FROM public.organizations WHERE name=ent_names[i] AND reseller_id=res_id;
    IF org_id IS NULL THEN
      INSERT INTO public.organizations (name,status,enterprise_type,reseller_id,created_by_user_id)
           VALUES (ent_names[i],'active','inorganic',res_id,owner_id)
        RETURNING id INTO org_id;
    END IF;

    eadm_id := public._seed_user(eadm_email, eadm_pw, ent_names[i]||' Admin');
    INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded, organization_id)
         VALUES (eadm_id, ent_names[i]||' Admin', rid_entadmin, true, org_id)
    ON CONFLICT (id) DO UPDATE
       SET full_name=EXCLUDED.full_name, primary_role_id=EXCLUDED.primary_role_id,
           is_onboarded=true, organization_id=EXCLUDED.organization_id;
    INSERT INTO public.user_roles (user_id,role_id) VALUES (eadm_id,rid_entadmin)
    ON CONFLICT (user_id,role_id) DO NOTHING;

    ent_used := 0;

    FOR k IN 1..array_length(dept_names,1) LOOP
      dept_slug  := dept_slugs[k];
      dadm_email := CASE WHEN ent_slug='virta' AND dept_slug='eng' THEN 'eng@relay.demo'
                         ELSE ent_slug||'.'||dept_slug||'@relay.demo' END;
      dadm_pw    := CASE WHEN dadm_email='eng@relay.demo' THEN 'Eng@2026' ELSE BULK_PW END;

      dadm_id := public._seed_user(dadm_email, dadm_pw, ent_names[i]||' '||dept_names[k]||' Admin');

      SELECT id INTO dept_id FROM public.departments WHERE enterprise_id=org_id AND name=dept_names[k];
      IF dept_id IS NULL THEN
        INSERT INTO public.departments (enterprise_id,name,admin_user_id,status,created_by_user_id)
             VALUES (org_id, dept_names[k], dadm_id, 'active', owner_id)
          RETURNING id INTO dept_id;
      ELSE
        UPDATE public.departments SET admin_user_id=dadm_id WHERE id=dept_id;
      END IF;

      INSERT INTO public.profiles (id, full_name, primary_role_id, is_onboarded, organization_id, department_id, client_type)
           VALUES (dadm_id, ent_names[i]||' '||dept_names[k]||' Admin', rid_deptadmin, true, org_id, dept_id, 'client')
      ON CONFLICT (id) DO UPDATE
         SET full_name=EXCLUDED.full_name, primary_role_id=EXCLUDED.primary_role_id, is_onboarded=true,
             organization_id=EXCLUDED.organization_id, department_id=EXCLUDED.department_id;
      INSERT INTO public.user_roles (user_id,role_id) VALUES (dadm_id,rid_deptadmin)
      ON CONFLICT (user_id,role_id) DO NOTHING;

      dept_used := 0;

      FOR m IN 1..EMP_PER_DEPT LOOP
        g := g + 1;
        emp_email := CASE WHEN ent_slug='virta' AND dept_slug='eng' AND m=1 THEN 'emp@relay.demo'
                          ELSE ent_slug||'.'||dept_slug||'.e'||m||'@relay.demo' END;
        emp_pw    := CASE WHEN emp_email='emp@relay.demo' THEN 'Emp@2026' ELSE BULK_PW END;
        emp_name  := firsts[1 + (((hashtext(emp_email)        % 40) + 40) % 40)]
                  || ' ' ||
                     lasts [1 + (((hashtext(emp_email||'|s')   % 40) + 40) % 40)];

        emp_alloc := 600 + 2 * g;     -- unique allocation per employee
        emp_used  := 20 + g;          -- unique usage per employee

        emp_id := public._seed_user(emp_email, emp_pw, emp_name);
        INSERT INTO public.profiles (
          id, full_name, primary_role_id, is_onboarded,
          organization_id, department_id, client_type, status,
          allocated_minutes, used_minutes, remaining_minutes
        ) VALUES (
          emp_id, emp_name, rid_client, true,
          org_id, dept_id, 'employee', 'active',
          emp_alloc, emp_used, emp_alloc - emp_used
        )
        ON CONFLICT (id) DO UPDATE
           SET full_name=EXCLUDED.full_name, primary_role_id=EXCLUDED.primary_role_id, is_onboarded=true,
               organization_id=EXCLUDED.organization_id, department_id=EXCLUDED.department_id,
               client_type='employee', status='active',
               allocated_minutes=EXCLUDED.allocated_minutes, used_minutes=EXCLUDED.used_minutes,
               remaining_minutes=EXCLUDED.remaining_minutes;
        INSERT INTO public.user_roles (user_id,role_id) VALUES (emp_id,rid_client)
        ON CONFLICT (user_id,role_id) DO NOTHING;

        dept_used := dept_used + emp_used;
      END LOOP;  -- employees

      UPDATE public.departments
         SET allocated_minutes=5000, used_minutes=dept_used, remaining_minutes=5000-dept_used
       WHERE id=dept_id;
      ent_used := ent_used + dept_used;
    END LOOP;  -- departments

    UPDATE public.organizations
       SET allocated_minutes=30000, used_minutes=ent_used, remaining_minutes=30000-ent_used
     WHERE id=org_id;
    res_used := res_used + ent_used;
  END LOOP;  -- enterprises

  UPDATE public.resellers
     SET allocated_minutes=200000, used_minutes=res_used, remaining_minutes=200000-res_used, commission=10
   WHERE id=res_id;

  RAISE NOTICE 'Epicenter seeded: 1 channel partner, 5 enterprises, 25 departments, % employees.', g;
END
$epi$;

DROP FUNCTION IF EXISTS public._seed_user(text, text, text);

COMMIT;

-- ── Key demo logins (shows in the SQL editor results pane) ───────────────────
SELECT kind, email, password FROM (VALUES
  ('channel partner (Epicenter)',          'epicenter@relay.demo', 'Epicenter@2026'),
  ('enterprise — Virta',                    'virta@relay.demo',     'Virta@2026'),
  ('department — Virta · Engineering',      'eng@relay.demo',       'Eng@2026'),
  ('employee — Virta · Engineering',        'emp@relay.demo',       'Emp@2026')
) AS t(kind, email, password);
