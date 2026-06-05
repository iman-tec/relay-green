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
    name: "Free",
    minutes: 10,
    priceCents: 0,
    blurb: "Try Relay with a one-time session — no card required.",
    cta: "Free",
    purchasable: false,
    features: [
      "One session per customer",
      "Up to 10 minutes with an engineer",
      "Live chat + voice + screen share",
      "No credit card required",
    ],
  },
  {
    code: "base",
    name: "Base",
    minutes: 100,
    priceCents: 5000,
    blurb: "Good for a few sessions over a few months.",
    cta: "€50",
    purchasable: true,
    features: [
      "100 minutes of engineer time",
      "Use across as many sessions as you need",
      "Credits good for 12 months",
    ],
  },
  {
    code: "pro",
    name: "Pro",
    minutes: 240,
    priceCents: 10000,
    blurb: "Steady progress on a growing build.",
    cta: "€100",
    purchasable: true,
    highlight: true,
    features: [
      "240 minutes of engineer time",
      "Priority matching with your engineer",
      "Credits good for 12 months",
    ],
  },
  {
    code: "max",
    name: "Max",
    minutes: 500,
    priceCents: 20000,
    blurb: "Ongoing work and bigger projects.",
    cta: "€200",
    purchasable: true,
    features: [
      "500 minutes of engineer time",
      "Priority matching with your engineer",
      "Credits good for 12 months",
    ],
  },
] as const;

export const LAUNCH_PLANS = [
  {
    code: "launch_simple",
    name: "Simple",
    blurb: "Single integration · fixed scope.",
    priceLabel: "€1,500",
    suffix: "fixed",
    features: [
      "Single integration",
      "Fixed scope, fixed price",
      "~2-week delivery",
    ],
  },
  {
    code: "launch_medium",
    name: "Medium",
    blurb: "Multi-system rollout with compliance review.",
    priceLabel: "€3,000",
    suffix: "fixed",
    features: ["Multi-system", "Basic compliance review", "~4-week delivery"],
  },
  {
    code: "launch_complex",
    name: "Complex",
    blurb: "Regulated, multi-region, high-throughput launches.",
    priceLabel: "€5,000",
    suffix: "fixed",
    features: [
      "Multi-region · regulated",
      "High-throughput hardening",
      "Custom delivery plan",
    ],
  },
] as const;

export const RETAINER = {
  code: "retainer",
  name: "Retainer",
  blurb: "Same team that launched you keeps it shipping.",
  priceLabel: "€1K–€8K",
  suffix: "/ mo",
  features: [
    "Monthly retainer",
    "Same engineers throughout",
    "Priority response SLA",
  ],
} as const;

export type SupportPlanCode = (typeof SUPPORT_PLANS)[number]["code"];

export function planByCode(code: string) {
  return SUPPORT_PLANS.find((p) => p.code === code);
}
