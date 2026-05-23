/*
 * Pricing plan registry. Single source of truth for the tier rows shown on
 * the homepage (Build / Launch / Maintain) and on the /payment page.
 *
 * "free"   First-session offers; route to the booking/signup flow, not checkout.
 * "paid"   Fixed price; route to /payment?plan=<id> which creates a Stripe
 *          Checkout Session.
 * "quoted" Range-priced retainer; opens the inline PhaseCtaForm rather than
 *          a checkout (we don't bill until scope is agreed).
 */

export type PlanKind = "free" | "paid" | "quoted";

export type Plan = {
  id: string;
  phase: "phase1" | "phase2" | "phase3";
  name: string;
  detail: string;
  priceLabel: string;
  amountCents: number | null;
  currency: "eur";
  kind: PlanKind;
  contactTopic: "BUILD" | "LAUNCH" | "MAINTAIN";
};

export const PLANS: readonly Plan[] = [
  {
    id: "phase1-first",
    phase: "phase1",
    name: "First session",
    detail: "10 min on us",
    priceLabel: "Free",
    amountCents: null,
    currency: "eur",
    kind: "free",
    contactTopic: "BUILD",
  },
  {
    id: "phase1-base",
    phase: "phase1",
    name: "Base plan",
    detail: "100 min of support",
    priceLabel: "€50",
    amountCents: 5000,
    currency: "eur",
    kind: "paid",
    contactTopic: "BUILD",
  },
  {
    id: "phase1-pro",
    phase: "phase1",
    name: "Pro plan",
    detail: "240 min of support",
    priceLabel: "€100",
    amountCents: 10_000,
    currency: "eur",
    kind: "paid",
    contactTopic: "BUILD",
  },
  {
    id: "phase1-max",
    phase: "phase1",
    name: "Max plan",
    detail: "500 min of support",
    priceLabel: "€200",
    amountCents: 20_000,
    currency: "eur",
    kind: "paid",
    contactTopic: "BUILD",
  },
  {
    id: "phase2-simple",
    phase: "phase2",
    name: "Simple",
    detail: "Single integration",
    priceLabel: "€1,500",
    amountCents: null,
    currency: "eur",
    kind: "quoted",
    contactTopic: "LAUNCH",
  },
  {
    id: "phase2-medium",
    phase: "phase2",
    name: "Medium",
    detail: "Multi-system, basic compliance",
    priceLabel: "€3,000",
    amountCents: null,
    currency: "eur",
    kind: "quoted",
    contactTopic: "LAUNCH",
  },
  {
    id: "phase2-complex",
    phase: "phase2",
    name: "Complex",
    detail: "Regulated · multi-region · high-throughput",
    priceLabel: "€5,000",
    amountCents: null,
    currency: "eur",
    kind: "quoted",
    contactTopic: "LAUNCH",
  },
  {
    id: "phase3-simple",
    phase: "phase3",
    name: "Simple",
    detail: "Steady-state maintenance",
    priceLabel: "€1,000 / mo",
    amountCents: null,
    currency: "eur",
    kind: "quoted",
    contactTopic: "MAINTAIN",
  },
  {
    id: "phase3-medium",
    phase: "phase3",
    name: "Medium",
    detail: "Active iteration and on-call",
    priceLabel: "€4,500 / mo",
    amountCents: null,
    currency: "eur",
    kind: "quoted",
    contactTopic: "MAINTAIN",
  },
  {
    id: "phase3-complex",
    phase: "phase3",
    name: "Complex",
    detail: "Dedicated team, compliance, scale",
    priceLabel: "€8,000 / mo",
    amountCents: null,
    currency: "eur",
    kind: "quoted",
    contactTopic: "MAINTAIN",
  },
];

export function getPlan(id: string): Plan | null {
  return PLANS.find((p) => p.id === id) ?? null;
}

export function plansForPhase(phase: Plan["phase"]): Plan[] {
  return PLANS.filter((p) => p.phase === phase);
}
