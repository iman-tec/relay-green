/*
 * POST /api/enterprise/wallet/activate-plan
 *
 * Called from the wallet page after Stripe.confirmPayment() succeeds.
 * Flips the org's plan_tier, marks status=active, and rolls the
 * current_period_end forward by one month. Idempotent — safe to call
 * twice for the same payment.
 *
 * Body: { tier: 'starter'|'pro'|'business'|'enterprise', paymentIntentId?: string }
 *
 * Note: in production this should be driven by a Stripe webhook
 * (payment_intent.succeeded) rather than trusted from the browser.
 * Keeping it here as the demo-friendly synchronous path; webhook can
 * still fire and find the row already updated (no-op).
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { PLAN_CATALOG, type PlanTier } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const VALID_TIERS = new Set<PlanTier>(["starter", "pro", "business", "enterprise"]);

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { tier, paymentIntentId } = (await request.json().catch(() => ({}))) as {
    tier?: PlanTier; paymentIntentId?: string;
  };

  if (!tier || !VALID_TIERS.has(tier)) {
    return NextResponse.json({ error: "Need tier ∈ starter/pro/business/enterprise." }, { status: 400 });
  }
  const planDef = PLAN_CATALOG[tier];
  if (planDef.monthlyPriceCents == null && tier === "enterprise") {
    // Enterprise tier is contact-sales. Can be set by support manually,
    // not via self-serve checkout. Don't activate here.
    return NextResponse.json(
      { error: "Enterprise tier is contact-sales — reach out to your account manager." },
      { status: 400 },
    );
  }

  // Renewal date = one month from now.
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { error } = await admin
    .from("organizations")
    .update({
      plan_tier:                tier,
      plan_status:              "active",
      plan_current_period_end:  periodEnd.toISOString(),
    })
    .eq("id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  console.log(
    `[enterprise/wallet] org=${orgId} activated tier=${tier} (paymentIntent=${paymentIntentId ?? "n/a"})`,
  );
  return NextResponse.json({
    ok: true,
    plan: {
      tier:                  planDef.tier,
      name:                  planDef.name,
      monthlyPriceCents:     planDef.monthlyPriceCents,
      status:                "active",
      currentPeriodEnd:      periodEnd.toISOString(),
    },
  });
}
