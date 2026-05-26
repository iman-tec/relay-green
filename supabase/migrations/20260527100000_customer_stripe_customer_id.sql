-- ============================================================================
-- Relay — Stable Stripe Customer id per Relay customer
-- ============================================================================
-- Until now, every checkout created a fresh Stripe Customer (or none at
-- all — the relay-stripe-webhook stores only payment_intent ids). To
-- support saved payment methods we need a stable, per-Relay-customer
-- Stripe Customer object that:
--   • Cards attach to (PaymentMethod.attach with customer = sc_xxx)
--   • Future checkouts pass via `customer` so the card list works
--   • Webhook can update on payment success (idempotent upsert)
--
-- This migration adds the column and a partial unique index. The
-- /api/billing/payment-methods/setup-intent route creates the Stripe
-- Customer lazily on first add and persists the id here.
-- ============================================================================

BEGIN;

ALTER TABLE public.customer_entitlements
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Partial unique index — we don't want to enforce uniqueness on NULL
-- (every customer who hasn't added a payment method yet), only on real
-- stripe customer ids. Without this, the second customer who needs a
-- Stripe Customer would collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_entitlements_stripe_customer
  ON public.customer_entitlements(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN public.customer_entitlements.stripe_customer_id IS
  'Stripe Customer id (cus_xxx). Lazily created when the customer adds their first payment method via /api/billing/payment-methods/setup-intent.';

COMMIT;
