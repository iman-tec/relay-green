-- ============================================================================
-- Channel Partner program — Phase 2 (onboarding + clickwrap + auto-discount).
-- ADDITIVE ONLY. Apply AFTER 20260607120000_partner_program.sql.
-- ============================================================================
-- One new column: the reseller's DEFAULT passthrough split. When a partner
-- onboards an enterprise without specifying a per-company discount, the org's
-- discount_pct (the passthrough, reused from Phase 1) inherits this value.
-- Per-company override remains the explicit discountPct on the onboarding call.
--
--   default_passthrough_pct : 0–100, must stay <= commission (the wholesale %)
--   — the same passthrough <= wholesale rule the onboarding route enforces.
-- ============================================================================

BEGIN;

ALTER TABLE public.resellers
  ADD COLUMN IF NOT EXISTS default_passthrough_pct numeric(5,2) NOT NULL DEFAULT 0
                            CHECK (default_passthrough_pct >= 0
                               AND default_passthrough_pct <= 100);

COMMIT;
