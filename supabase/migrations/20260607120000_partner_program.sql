-- ============================================================================
-- Channel Partner program — Phase 1 (data + billing math). ADDITIVE ONLY.
-- ============================================================================
-- Reuses the discount fields that already exist:
--   * resellers.commission        (numeric 0–100) = the Relay→partner WHOLESALE
--     discount off list. Surfaced today via /api/enterprise/me; now also the
--     base for partner margin accrual.
--   * organizations.discount_pct  (numeric 0–100) = the partner→enterprise
--     PASSTHROUGH discount (set at onboarding via /api/reseller/enterprises).
--   * organizations.discount_until                = passthrough expiry window.
--
-- Hard rule (enforced server-side in /api/reseller/enterprises):
--   passthrough (discount_pct) <= wholesale (commission).
--
-- This migration adds ONLY what is genuinely missing. It does NOT touch the
-- existing organizations.status (active/suspended) — partner lifecycle gets a
-- parallel `partner_status` column so non-partner billing is untouched.
-- New columns/tables are nullable or defaulted; every non-partner org and the
-- recharge mechanism behave identically.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. resellers: program tier + downloadable-badge version.
--    Tier is COMPUTED from monthly book spend (see lib/billing) and written
--    back here; the column is the cached current tier. `commission` already
--    exists and is the wholesale %, so nothing to add there.
-- ----------------------------------------------------------------------------
ALTER TABLE public.resellers
  ADD COLUMN IF NOT EXISTS tier          text NOT NULL DEFAULT 'partner'
                            CHECK (tier IN ('partner', 'premier')),
  ADD COLUMN IF NOT EXISTS badge_version int  NOT NULL DEFAULT 1;

-- ----------------------------------------------------------------------------
-- 2. organizations: partner onboarding lifecycle.
--    Existing `status` (active/suspended) is LEFT ALONE. `partner_status` is a
--    nullable parallel lifecycle that only partner-onboarded orgs use:
--      invited → admin invited, not yet accepted clickwrap
--      active  → clickwrap accepted, effective discount live
--      paused  → partner relationship paused (billing unaffected unless wired)
--    NULL = not a partner-onboarded org (organic / pre-program inorganic).
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS partner_status text
                            CHECK (partner_status IN ('invited', 'active', 'paused')),
  ADD COLUMN IF NOT EXISTS onboarded_at   timestamptz;

-- ----------------------------------------------------------------------------
-- 3. terms_acceptances: clickwrap contract of record.
--    One row per affirmative "I Agree". Archives the exact version shown
--    (terms_version + optional content hash) plus identity/time/IP. Material
--    terms changes require a fresh acceptance (a new row with a new version).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  admin_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  terms_version  text NOT NULL,
  terms_sha256   text,                 -- hash of the exact text shown (archival integrity)
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_enterprise
  ON public.terms_acceptances (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_admin
  ON public.terms_acceptances (admin_user_id);

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Org members read their own org's acceptances; writes happen server-side via
-- the service-role client (which bypasses RLS), so no INSERT policy needed.
CREATE POLICY terms_acceptances_org_read
  ON public.terms_acceptances FOR SELECT
  TO authenticated
  USING (
    enterprise_id IN (
      SELECT p.organization_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.organization_id IS NOT NULL
    )
  );

CREATE POLICY terms_acceptances_super_admin_all
  ON public.terms_acceptances FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ----------------------------------------------------------------------------
-- 4. partner_payouts: the remittance ledger.
--    Stores PAID-OUT records (what Relay has remitted). "Earned" is computed
--    from usage × (commission − discount_pct) at read time — we do not store a
--    denormalized earned figure here to avoid drift. `earned_cents` is an
--    optional snapshot taken at the moment a payout is cut, for the receipt.
--      Balance due = SUM(earned to date) − SUM(paid_cents).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id  uuid NOT NULL REFERENCES public.resellers(id) ON DELETE CASCADE,
  period       text NOT NULL,          -- 'YYYY-MM' the payout covers
  earned_cents bigint NOT NULL DEFAULT 0,   -- snapshot of margin accrued for the period
  paid_cents   bigint NOT NULL DEFAULT 0,   -- actually remitted
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'paid', 'void')),
  note         text,
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One payout row per (reseller, period) — re-cutting a period updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_payouts_reseller_period
  ON public.partner_payouts (reseller_id, period);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_reseller
  ON public.partner_payouts (reseller_id);

ALTER TABLE public.partner_payouts ENABLE ROW LEVEL SECURITY;

-- Reseller reads its own payout history; writes are service-role only.
CREATE POLICY partner_payouts_self_read
  ON public.partner_payouts FOR SELECT
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY partner_payouts_super_admin_all
  ON public.partner_payouts FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

COMMIT;
