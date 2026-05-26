-- ============================================================================
-- Company promo discount granted at onboarding by a Channel Partner.
-- ============================================================================
-- A Channel Partner can grant the company a percentage discount for a fixed
-- window when they onboard it (e.g. 10% for 12 months). Persisted on the org.
--   discount_pct   : 0–100, the promo discount percentage on usage spend.
--   discount_until : when the promo expires (NULL = none / indefinite).
-- ============================================================================

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS discount_pct   numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_until timestamptz;

COMMIT;
