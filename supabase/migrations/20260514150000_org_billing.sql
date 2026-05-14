-- Enterprise plan + billing columns on organizations.
--
-- The enterprise dashboard exposes two billing concepts to the
-- enterprise_admin:
--   1. Revenue (incoming) — what their org earns from customer calls.
--      Computed on-the-fly from guest_calls.duration_minutes × rate, no
--      schema needed.
--   2. Plan (outgoing) — what the enterprise pays us for the platform
--      itself. This block stores the bare minimum to surface plan tier,
--      status, next-renewal date, and the Stripe handles so we can open
--      the billing portal from the UI.
--
-- For local dev / demos, plan info is seeded by hand. Real Stripe webhook
-- sync (customer.subscription.updated → upsert into this row) lands in a
-- follow-up.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_tier               text        NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS plan_status             text        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan_current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text,
  ADD COLUMN IF NOT EXISTS billing_currency        text        NOT NULL DEFAULT 'EUR';

-- Constrain the enum-ish columns so a fat-fingered update doesn't leak
-- through. Both are extensible — add tiers/states to the array as we
-- grow.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'organizations'
      AND constraint_name = 'organizations_plan_tier_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_plan_tier_check
      CHECK (plan_tier IN ('starter','pro','business','enterprise'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'organizations'
      AND constraint_name = 'organizations_plan_status_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_plan_status_check
      CHECK (plan_status IN ('active','trialing','past_due','canceled','paused'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer
  ON public.organizations(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
