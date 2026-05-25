-- ============================================================================
--  Set a known password for the four Engineer accounts (demo login)
-- ============================================================================
--  Existing passwords are bcrypt-hashed (one-way) and CANNOT be read back, so
--  this SETS a new known password (overwriting any previous one) and flips the
--  password_set flag so /staff/login accepts the password without diverting to
--  /set-password.
--
--    Password for ALL four engineers:  RelayEng@2026
--
--  Matched by the four exact emails (their "Engineer" role comes from pod
--  membership, not a user_roles row, so a role-based match would miss them).
--  Idempotent: re-running just re-asserts the same password.
--
--  HOW TO RUN: paste into the Supabase SQL editor and Run. It should return
--  4 rows — one per engineer. If it returns fewer, an email below differs from
--  the live address; tell me the exact ones.
-- ============================================================================

UPDATE auth.users u
   SET encrypted_password = extensions.crypt('RelayEng@2026', extensions.gen_salt('bf')),
       raw_app_meta_data  = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
                              || jsonb_build_object('password_set', true),
       email_confirmed_at = COALESCE(u.email_confirmed_at, now()),
       updated_at         = now()
 WHERE lower(u.email) IN (
   'freya.ivanov@yopmail.com',
   'freya.bauer@yopmail.com',
   'anaya.muller@yopmail.com',
   'olivia.nguyen@yopmail.com'
 )
RETURNING u.email AS engineer_email,
          (u.raw_app_meta_data->>'password_set') AS password_set;
