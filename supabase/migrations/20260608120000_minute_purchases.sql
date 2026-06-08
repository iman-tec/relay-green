-- ============================================================================
-- Minute-bundle purchase ledger (enterprise wallet top-ups).
-- ============================================================================
-- Each successful Stripe top-up (POST /api/enterprise/wallet/topup) records a
-- dated row here so the company's Billing → Recent transactions list can show
-- recharges with a date + amount. The org's minute pool is still credited on
-- organizations.{allocated,remaining}_minutes; this table is the human-readable
-- transaction trail, keyed by the Stripe PaymentIntent for idempotency.
--
-- Additive only — no existing table/column changes, no money-path mutation
-- (crediting still happens exactly as before; this is a write-after record).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.minute_purchases (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  minutes                   integer NOT NULL CHECK (minutes > 0),
  amount_cents              integer NOT NULL CHECK (amount_cents >= 0),
  currency                  text    NOT NULL DEFAULT 'eur',
  bundle_code               text,
  stripe_payment_intent_id  text UNIQUE,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minute_purchases_org_created
  ON public.minute_purchases (organization_id, created_at DESC);

-- Deny-by-default. The only reader/writer is the server (service-role) via the
-- wallet/billing route handlers; no browser client touches this table directly,
-- so we intentionally add NO client policies — prevents any cross-org leak.
ALTER TABLE public.minute_purchases ENABLE ROW LEVEL SECURITY;

COMMIT;
