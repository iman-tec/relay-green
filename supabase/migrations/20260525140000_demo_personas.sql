-- ============================================================================
--  DEMO PERSONAS  —  give every seeded synthetic account a real human name
-- ============================================================================
--  Renames ONLY the person's name + email. Nothing else changes: minutes,
--  balances, roles, reseller/enterprise/department entity labels, codes, and
--  the hierarchy all stay exactly as they are.
--
--  Targets (matched by their current placeholder email):
--    • reseller owners      reseller NN @relay.demo
--    • enterprise admins    rNNeMM-admin @relay.demo
--    • department admins    rNNeMMdKK-admin @relay.demo
--    • members (employees)  rNNeMMdKKmPP @relay.demo
--    • engineers            relay.engNN @yopmail.com
--    • supervisors          relay.supNN @yopmail.com
--
--  Left untouched (already real personas): madhav.anadkat@thegatewaycorp.co.in,
--  gaute.green@thegatewaycorp.com, admin@relay.com.
--
--  Each person gets a globally-unique random name (e.g. "Lucia Mehta") and a
--  matching email (lucia.mehta@relay.demo, or @yopmail.com for staff so their
--  OTP inbox keeps working).
--
--  IMPLEMENTATION NOTE: written as a SINGLE statement using data-modifying
--  CTEs (no TEMP table) so it runs correctly in the Supabase SQL editor, which
--  does not keep session-local temp tables alive across separate statements.
--  The `map` CTE is MATERIALIZED → computed once from the ORIGINAL emails, then
--  every UPDATE reads the same snapshot, so changing auth.users.email does not
--  disturb the matching of the other tables.
--
--  One-time rename. Re-running is a safe no-op (renamed accounts no longer
--  match the placeholder patterns).
--
--  HOW TO RUN: paste this whole file into the Supabase SQL editor and Run.
-- ============================================================================

WITH pools(firsts, lasts) AS MATERIALIZED (
  SELECT
    ARRAY[
      'Aarav','Olivia','Liam','Sofia','Noah','Emma','Arjun','Mia','Lucas','Ava',
      'Mateo','Isla','Ethan','Aria','Kai','Zara','Leo','Chloe','Ravi','Maya',
      'Felix','Nora','Omar','Ines','Hugo','Lena','Diego','Priya','Marco','Yuki',
      'Ivan','Amara','Theo','Hana','Sven','Lucia','Tariq','Freya','Niko','Anaya'
    ],
    ARRAY[
      'Sharma','Andersen','Okafor','Rossi','Nguyen','Kim','Patel','Muller','Silva','Johansson',
      'Haddad','Tanaka','Novak','Costa','Ivanov','Mehta','Bauer','Lindqvist','Reyes','Khan',
      'Dubois','Romano','Walsh','Cohen','Mbeki','Park','Singh','Larsen','Moreau','Fernandes',
      'Volkov','Iyer','Schneider','Bianchi','Owusu','Sato','Kowalski','Berg','Acosta','Rao'
    ]
),
targets AS MATERIALIZED (
  SELECT
    u.id,
    CASE WHEN u.email ~ '@yopmail\.com$' THEN 'yopmail.com' ELSE 'relay.demo' END AS domain
  FROM auth.users u
  WHERE u.email ~ '^reseller[0-9]+@relay\.demo$'
     OR u.email ~ '^r[0-9]+e[0-9]+-admin@relay\.demo$'
     OR u.email ~ '^r[0-9]+e[0-9]+d[0-9]+-admin@relay\.demo$'
     OR u.email ~ '^r[0-9]+e[0-9]+d[0-9]+m[0-9]+@relay\.demo$'
     OR u.email ~ '^relay\.(eng|sup)[0-9]+@yopmail\.com$'
),
-- Random-but-deterministic ordering, then bijective decomposition into
-- (first,last) pairs → every person gets a UNIQUE name. 40×40 = 1600 pairs,
-- far more than the ~786 people, so no collisions and no numeric suffixes.
ranked AS MATERIALIZED (
  SELECT id, domain,
         (row_number() OVER (ORDER BY hashtext(id::text), id) - 1) AS pair
  FROM targets
),
map AS MATERIALIZED (
  SELECT
    r.id,
    pl.firsts[1 + (r.pair % 40)] || ' ' || pl.lasts[1 + ((r.pair / 40) % 40)]                       AS new_name,
    lower(pl.firsts[1 + (r.pair % 40)]) || '.' || lower(pl.lasts[1 + ((r.pair / 40) % 40)])
      || '@' || r.domain                                                                            AS new_email
  FROM ranked r CROSS JOIN pools pl
),
u_users AS (
  UPDATE auth.users u
     SET email              = m.new_email,
         raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb)
                                || jsonb_build_object('full_name', m.new_name, 'display_name', m.new_name),
         updated_at         = now()
    FROM map m
   WHERE u.id = m.id
  RETURNING 1
),
u_ident AS (
  UPDATE auth.identities i
     SET identity_data = i.identity_data || jsonb_build_object('email', m.new_email),
         updated_at    = now()
    FROM map m
   WHERE i.user_id = m.id AND i.provider = 'email'
  RETURNING 1
),
u_prof AS (
  UPDATE public.profiles p
     SET full_name = m.new_name
    FROM map m
   WHERE p.id = m.id
  RETURNING 1
),
u_res AS (
  UPDATE public.resellers r
     SET email = m.new_email
    FROM map m
   WHERE r.owner_user_id = m.id
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM map)     AS people_mapped,
  (SELECT count(*) FROM u_users) AS users_updated,
  (SELECT count(*) FROM u_ident) AS identities_updated,
  (SELECT count(*) FROM u_prof)  AS profiles_updated,
  (SELECT count(*) FROM u_res)   AS resellers_updated;

-- ── Sample of the result (separate read-only statement) ──────────────────────
SELECT u.email, p.full_name, r.name AS role
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
LEFT JOIN public.roles r ON r.id = ur.role_id
WHERE u.email LIKE '%@relay.demo' OR u.email LIKE '%@yopmail.com'
ORDER BY u.email
LIMIT 15;
