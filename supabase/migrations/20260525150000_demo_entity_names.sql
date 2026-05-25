-- ============================================================================
--  DEMO ENTITY NAMES  —  give resellers / enterprises / departments real labels
-- ============================================================================
--  Renames ONLY the entity titles. People (reseller owners, enterprise admins,
--  department admins, members) were already renamed by 20260525140000. Minutes,
--  balances, codes, roles, and the hierarchy structure are untouched.
--
--    • resellers    'Reseller NN'            → a partner/company name (5 distinct)
--    • enterprises  'RNN Enterprise MM'      → a company name        (25 distinct)
--    • departments  'RNNEMMM Dept KK'        → a real department name
--                                              (Engineering / Finance / Sales /
--                                               Customer Support / Operations —
--                                               5 distinct per enterprise, which
--                                               satisfies UNIQUE(enterprise_id,name))
--
--  Matched by the current placeholder labels, so only the seeded entities are
--  touched and re-running is a safe no-op. Single statement (data-modifying
--  CTEs, no TEMP table) so it runs cleanly in the Supabase SQL editor.
--
--  HOW TO RUN: paste this whole file into the Supabase SQL editor and Run.
-- ============================================================================

WITH reseller_pool(arr) AS MATERIALIZED (
  SELECT ARRAY[
    'Apex Partners','Beacon Distribution','Catalyst Channel','Delta Group',
    'Everest Partners','Fulcrum Solutions','Granite Channel','Horizon Partners'
  ]
),
company_pool(arr) AS MATERIALIZED (
  SELECT ARRAY[
    'Northwind Labs','Brightwave Systems','Cobalt Analytics','Meridian Cloud','Vantage Robotics',
    'Lumen Dynamics','Solstice Software','Ironclad Security','Verdant Energy','Polaris Fintech',
    'Cedar Grove Media','Quantum Forge','Atlas Logistics','Nimbus Networks','Driftwood Studios',
    'Silverline Health','Tideway Marine','Ember Retail','Halcyon Bio','Junction AI',
    'Keystone Mobility','Larkspur Foods','Monarch Aerospace','Onyx Telecom','Pinnacle Realty',
    'Riverstone Bank','Summit Outdoors','Trailhead Travel','Vela Pharma','Westfield Industrial'
  ]
),
dept_pool(arr) AS MATERIALIZED (
  SELECT ARRAY['Engineering','Finance','Sales','Customer Support','Operations']
),
res_ranked AS MATERIALIZED (
  SELECT id, row_number() OVER (ORDER BY name) AS rn
  FROM public.resellers
  WHERE name ~ '^Reseller [0-9]+$'
),
ent_ranked AS MATERIALIZED (
  SELECT id, row_number() OVER (ORDER BY name) AS rn
  FROM public.organizations
  WHERE name ~ '^R[0-9]+ Enterprise [0-9]+$'
),
dept_ranked AS MATERIALIZED (
  SELECT id, row_number() OVER (PARTITION BY enterprise_id ORDER BY name) AS pos
  FROM public.departments
  WHERE name ~ '^R[0-9]+E[0-9]+ Dept [0-9]+$'
),
u_res AS (
  UPDATE public.resellers r
     SET name = (SELECT arr FROM reseller_pool)[rr.rn]
    FROM res_ranked rr
   WHERE r.id = rr.id
  RETURNING 1
),
u_ent AS (
  UPDATE public.organizations o
     SET name = (SELECT arr FROM company_pool)[er.rn]
    FROM ent_ranked er
   WHERE o.id = er.id
  RETURNING 1
),
u_dept AS (
  UPDATE public.departments d
     SET name = (SELECT arr FROM dept_pool)[dr.pos]
    FROM dept_ranked dr
   WHERE d.id = dr.id
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM u_res)  AS resellers_renamed,
  (SELECT count(*) FROM u_ent)  AS enterprises_renamed,
  (SELECT count(*) FROM u_dept) AS departments_renamed;

-- ── Sample of the result (separate read-only statement) ──────────────────────
SELECT res.name AS reseller, o.name AS enterprise, d.name AS department
FROM public.resellers res
JOIN public.organizations o ON o.reseller_id = res.id
JOIN public.departments d ON d.enterprise_id = o.id
ORDER BY res.name, o.name, d.name
LIMIT 12;
