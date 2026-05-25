-- ============================================================================
--  Rename internal user "ngemawat" → "Niraj Gemawat"  (display name only)
-- ============================================================================
--  Changes ONLY the person's name (profiles.full_name + auth user metadata).
--  Email, role, status, and everything else are untouched.
--
--  Matched by local-part 'ngemawat@thegatewaycorp.%' so it works whether the
--  address is @thegatewaycorp.com (as shown in the UI) or @thegatewaycorp.co.in.
--
--  HOW TO RUN: paste into the Supabase SQL editor and Run.
-- ============================================================================

WITH tgt AS (
  SELECT id FROM auth.users
   WHERE lower(email) LIKE 'ngemawat@thegatewaycorp.%'
),
u_meta AS (
  UPDATE auth.users u
     SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('full_name', 'Niraj Gemawat', 'display_name', 'Niraj Gemawat'),
         updated_at = now()
    FROM tgt
   WHERE u.id = tgt.id
  RETURNING 1
),
u_prof AS (
  UPDATE public.profiles p
     SET full_name = 'Niraj Gemawat'
    FROM tgt
   WHERE p.id = tgt.id
  RETURNING 1
)
SELECT (SELECT count(*) FROM u_meta) AS users_updated,
       (SELECT count(*) FROM u_prof) AS profiles_updated;

-- ── Confirm ──────────────────────────────────────────────────────────────────
SELECT u.email, p.full_name
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE lower(u.email) LIKE 'ngemawat@thegatewaycorp.%';
