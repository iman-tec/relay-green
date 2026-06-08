-- ============================================================================
-- Individual-referral commission model — Phase 2 foundation. ADDITIVE ONLY.
-- ============================================================================
-- Separate economics from the enterprise 20% wholesale-passthrough:
--   * An individual who signs up via a partner's Resources referral link
--     (https://<domain>/?ref=<reseller_code>) is a STANDALONE organic customer
--     (profiles.organization_id IS NULL) — never an enterprise employee.
--   * Default 10/10 (super-admin editable, mirroring resellers.commission):
--       individual gets 10% discount, partner earns 10% commission.
--   * Attribution is durable on profiles.reseller_id (already exists, unused for
--     organics) PLUS a dated row here so every accrual is traceable.
--
-- Anti-double-count: attribution + accrual happen ONLY for organic customers
-- (organization_id IS NULL). Enterprise passthrough margin derives from
-- organizations.used_minutes — a disjoint row set. An individual is never also
-- an enterprise passthrough.
--
-- Flag-off (NEXT_PUBLIC_PARTNER_PROGRAM=0): no capture/attribution/accrual code
-- runs; these columns/tables simply stay empty. Non-partner billing is identical.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. resellers: the 10/10 defaults. Fixed defaults, super-admin editable per
--    partner via PATCH /api/admin/resellers/:id (same surface as `commission`).
-- ----------------------------------------------------------------------------
ALTER TABLE public.resellers
  ADD COLUMN IF NOT EXISTS individual_referral_discount_pct   numeric(5,2) NOT NULL DEFAULT 10
                            CHECK (individual_referral_discount_pct   BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS individual_referral_commission_pct numeric(5,2) NOT NULL DEFAULT 10
                            CHECK (individual_referral_commission_pct BETWEEN 0 AND 100);

-- ----------------------------------------------------------------------------
-- 2. individual_referrals: the attribution record. ONE row per referred
--    individual (UNIQUE customer_user_id) — idempotent attribution. Snapshots
--    the rates in force at attribution so later default edits don't rewrite
--    history. status: active → converted (joined an org, accrual stops) /
--    churned. profiles.reseller_id is also set for the durable link.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.individual_referrals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id            uuid NOT NULL REFERENCES public.resellers(id) ON DELETE CASCADE,
  customer_user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ref_code               text,                 -- the reseller_code used (audit trail)
  discount_pct_applied   numeric(5,2) NOT NULL, -- snapshot at attribution
  commission_pct_applied numeric(5,2) NOT NULL, -- snapshot at attribution
  status                 text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'converted', 'churned')),
  referred_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- One attribution per individual — enforces "add-once", guards re-attribution.
CREATE UNIQUE INDEX IF NOT EXISTS uq_individual_referrals_customer
  ON public.individual_referrals (customer_user_id);
CREATE INDEX IF NOT EXISTS idx_individual_referrals_reseller
  ON public.individual_referrals (reseller_id);

ALTER TABLE public.individual_referrals ENABLE ROW LEVEL SECURITY;

-- Partner reads its own referred individuals; the referred customer reads their
-- own row (rate transparency, read-only). Writes are service-role only.
CREATE POLICY individual_referrals_partner_read
  ON public.individual_referrals FOR SELECT
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY individual_referrals_customer_read
  ON public.individual_referrals FOR SELECT
  TO authenticated
  USING (customer_user_id = auth.uid());

CREATE POLICY individual_referrals_super_admin_all
  ON public.individual_referrals FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ----------------------------------------------------------------------------
-- 3. referral_commission_entries: the dated, append-only accrual ledger. ONE
--    row per billable event for an attributed individual. commission basis is
--    NET (post-discount) spend. Every accrual carries occurred_at so nothing is
--    undocumented. This is the SOURCE OF TRUTH for the partner's "Individual
--    referrals" view; the monthly partner_payouts cut sums these in (see #4).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_commission_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id      uuid NOT NULL REFERENCES public.resellers(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type      text NOT NULL CHECK (source_type IN ('bundle', 'session')),
  source_id        uuid,                  -- bundle purchase / guest_calls.id (traceability)
  gross_cents      bigint NOT NULL,       -- list spend before the individual discount
  discount_cents   bigint NOT NULL DEFAULT 0, -- discount given to the individual
  net_cents        bigint NOT NULL,       -- post-discount spend = commission basis
  commission_cents bigint NOT NULL,       -- net_cents × commission_pct (accrued to partner)
  occurred_at      timestamptz NOT NULL,  -- when the billable event happened (dated)
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_commission_reseller
  ON public.referral_commission_entries (reseller_id);
CREATE INDEX IF NOT EXISTS idx_referral_commission_customer
  ON public.referral_commission_entries (customer_user_id);
-- Idempotency guard for accrual: at most one entry per (source_type, source_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_commission_source
  ON public.referral_commission_entries (source_type, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE public.referral_commission_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_commission_partner_read
  ON public.referral_commission_entries FOR SELECT
  TO authenticated
  USING (
    reseller_id IN (
      SELECT p.reseller_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.reseller_id IS NOT NULL
    )
  );

CREATE POLICY referral_commission_super_admin_all
  ON public.referral_commission_entries FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'))
  WITH CHECK (has_role(auth.uid(), 'super_admin'));

-- ----------------------------------------------------------------------------
-- 4. partner_payouts: fold individual-referral commission into the monthly cut
--    while keeping the breakdown. earned_cents stays the TOTAL remitted basis;
--    referral_commission_cents is the slice of it that came from individual
--    referrals (the rest is enterprise passthrough margin). Separate ledger
--    (#3) remains the dated detail; this is the payout-level rollup.
-- ----------------------------------------------------------------------------
ALTER TABLE public.partner_payouts
  ADD COLUMN IF NOT EXISTS referral_commission_cents bigint NOT NULL DEFAULT 0;

COMMIT;
