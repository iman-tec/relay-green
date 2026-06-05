/*
 * Enterprise plan catalog. Code-side source of truth for plan
 * names, monthly price (EUR cents), and entitlements. The DB stores
 * just the tier slug (organizations.plan_tier) — everything else is
 * looked up here.
 *
 * When real Stripe pricing lands, replace stripePriceId placeholders
 * with the actual Price IDs and add a `stripeProductId` lookup so the
 * billing portal flow can target the right product.
 */

export type PlanTier = "starter" | "pro" | "business" | "enterprise";

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  description: string;
  monthlyPriceCents: number | null; // null = "Custom / contact sales"
  includedSeats: number | null; // null = unlimited
  features: string[];
  stripePriceId: string | null;
};

export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  starter: {
    tier: "starter",
    name: "Starter",
    description: "For small teams getting started with Relay.",
    monthlyPriceCents: 4900,
    includedSeats: 5,
    features: [
      "Up to 5 staff seats",
      "Customer-facing widget",
      "Email-only support",
    ],
    stripePriceId: null,
  },
  pro: {
    tier: "pro",
    name: "Pro",
    description: "For growing teams with regular customer call volume.",
    monthlyPriceCents: 19900,
    includedSeats: 20,
    features: [
      "Up to 20 staff seats",
      "Live supervise pit",
      "Priority support",
      "API access",
    ],
    stripePriceId: null,
  },
  business: {
    tier: "business",
    name: "Business",
    description: "For established orgs ready to scale.",
    monthlyPriceCents: 49900,
    includedSeats: 100,
    features: [
      "Up to 100 staff seats",
      "Advanced analytics + CSV export",
      "Dedicated success manager",
      "SSO (Google, Microsoft)",
    ],
    stripePriceId: null,
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    description: "Custom plans for the largest deployments.",
    monthlyPriceCents: null,
    includedSeats: null,
    features: [
      "Unlimited seats",
      "Custom SLAs",
      "Dedicated infrastructure",
      "SOC 2 / GDPR / DPA",
      "Priority engineering support",
    ],
    stripePriceId: null,
  },
};

export function formatEur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const euros = cents / 100;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: euros >= 100 ? 0 : 2,
  }).format(euros);
}
