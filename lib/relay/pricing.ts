/*
 * Relay pricing — single source of truth, used by:
 *   - the paywall UI (shows the cards)
 *   - the create-relay-checkout edge fn (mints a Stripe session)
 *   - the payments-webhook edge fn (credits the wallet)
 *
 * Phase 01 (Build) — pay-as-you-go support credits. Direct checkout.
 * Phase 02 (Launch) — fixed-price one-time launch projects. Get-in-touch.
 * Phase 03 (Maintain) — monthly retainer. Get-in-touch.
 */

export const SUPPORT_PLANS = [
  {
    code: "free",
    name: "First session",
    minutes: 10,
    priceCents: 0,
    blurb: "10 minutes on us — one session per customer.",
    cta: "Free",
    purchasable: false,
  },
  {
    code: "base",
    name: "Base",
    minutes: 100,
    priceCents: 5000,
    blurb: "100 minutes of support, valid 12 months.",
    cta: "€50",
    purchasable: true,
  },
  {
    code: "pro",
    name: "Pro",
    minutes: 240,
    priceCents: 10000,
    blurb: "240 minutes of support, valid 12 months.",
    cta: "€100",
    purchasable: true,
    highlight: true,
  },
  {
    code: "max",
    name: "Max",
    minutes: 500,
    priceCents: 20000,
    blurb: "500 minutes of support, valid 12 months.",
    cta: "€200",
    purchasable: true,
  },
] as const;

export const LAUNCH_PLANS = [
  { code: "launch_simple",  name: "Simple",  blurb: "Single integration",                          priceLabel: "€1,500" },
  { code: "launch_medium",  name: "Medium",  blurb: "Multi-system, basic compliance",              priceLabel: "€3,000" },
  { code: "launch_complex", name: "Complex", blurb: "Regulated · multi-region · high-throughput",  priceLabel: "€5,000" },
] as const;

export const RETAINER = {
  name: "Monthly retainer",
  blurb: "Quoted to your needs",
  priceLabel: "€1K – €8K / mo",
};

export type SupportPlanCode = (typeof SUPPORT_PLANS)[number]["code"];

export function planByCode(code: string) {
  return SUPPORT_PLANS.find((p) => p.code === code);
}
