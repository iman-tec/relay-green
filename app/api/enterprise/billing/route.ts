/*
 * Enterprise billing snapshot.
 *
 * GET /api/enterprise/billing
 *   Returns:
 *     - revenue.{thisMonth, last30Days, lifetime}: EUR cents, derived
 *       from session durations × per-minute rate. (Real billing wiring
 *       lands once we connect payment_events; this is a stand-in.)
 *     - plan: { tier, name, monthlyPriceCents, status, currentPeriodEnd,
 *               stripeCustomerId, stripeSubscriptionId, features,
 *               includedSeats }
 *     - recentTransactions: last 10 revenue events (one row per ended
 *       session, summarised).
 *
 * All amounts are EUR cents.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { PLAN_CATALOG, type PlanTier } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-minute rate the platform charges the enterprise's end-users. The
// enterprise's "revenue" is duration × this rate × markup. For now the
// markup is bundled into the rate (€3/min) — split when we wire the
// real billing schema.
const CENTS_PER_MINUTE = 300;

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  // 1. Org row — plan info + billing handles
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select(
      "id, name, plan_tier, plan_status, plan_current_period_end, " +
        "stripe_customer_id, stripe_subscription_id, billing_currency"
    )
    .eq("id", orgId)
    .single();
  if (orgErr || !org) {
    return NextResponse.json(
      { error: orgErr?.message ?? "Org not found." },
      { status: 404 }
    );
  }
  const orgRow = org as unknown as {
    id: string;
    name: string;
    plan_tier: PlanTier;
    plan_status: string;
    plan_current_period_end: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    billing_currency: string;
  };
  const planDef = PLAN_CATALOG[orgRow.plan_tier] ?? PLAN_CATALOG.starter;

  // 2. Org's profile pool (used in the OR-filter for sessions that don't
  //    have organization_id set directly).
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", orgId);
  const profileIds = ((profiles ?? []) as Array<{ id: string }>).map(
    (p) => p.id
  );

  // 3. Sessions across last 90 days (covers month, 30d, lifetime windows
  //    cheaply enough). Tighten the lifetime window if it ever blows up.
  const now = Date.now();
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );
  const since30 = new Date(now - 30 * 86_400_000);
  const since90 = new Date(now - 90 * 86_400_000);

  const orFilter =
    profileIds.length > 0
      ? `organization_id.eq.${orgId},customer_user_id.in.(${profileIds.join(",")})`
      : `organization_id.eq.${orgId}`;
  // GDPR minimization: the billing feed must not carry customer names or AI
  // summary content. Transactions are labelled generically by date, not by
  // who/what the session was about. See docs/gdpr-data-access-matrix.md.
  const { data: rows } = await admin
    .from("guest_calls")
    .select("id, status, created_at, ended_at, duration_minutes")
    .or(orFilter)
    .gte("created_at", since90.toISOString())
    .order("created_at", { ascending: false });

  const sessions = (rows ?? []) as Array<{
    id: string;
    status: string;
    created_at: string;
    ended_at: string | null;
    duration_minutes: number | null;
  }>;

  let thisMonth = 0;
  let last30 = 0;
  let lifetime = 0;
  for (const s of sessions) {
    if (s.status !== "ended" || !s.duration_minutes) continue;
    const cents = Math.round(Number(s.duration_minutes) * CENTS_PER_MINUTE);
    lifetime += cents;
    if (new Date(s.created_at) >= since30) last30 += cents;
    if (new Date(s.created_at) >= monthStart) thisMonth += cents;
  }

  // 4. Recent revenue events — last 10 ended sessions, formatted for the
  // transactions list.
  const recentTransactions = sessions
    .filter((s) => s.status === "ended" && s.duration_minutes)
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      occurredAt: s.ended_at ?? s.created_at,
      // Generic label — no customer name, no AI summary (PII minimization).
      label: "Engineering session",
      durationMin: Number(s.duration_minutes),
      amountCents: Math.round(Number(s.duration_minutes) * CENTS_PER_MINUTE),
      kind: "session_revenue" as const,
    }));

  return NextResponse.json({
    currency: orgRow.billing_currency || "EUR",
    revenue: {
      thisMonthCents: thisMonth,
      last30DaysCents: last30,
      lifetimeCents: lifetime,
      perMinuteCents: CENTS_PER_MINUTE,
    },
    plan: {
      tier: planDef.tier,
      name: planDef.name,
      description: planDef.description,
      monthlyPriceCents: planDef.monthlyPriceCents,
      includedSeats: planDef.includedSeats,
      features: planDef.features,
      status: orgRow.plan_status,
      currentPeriodEnd: orgRow.plan_current_period_end,
      // stripeCustomerId / stripeSubscriptionId intentionally NOT returned to
      // the browser — sensitive billing identifiers, never needed client-side.
    },
    recentTransactions,
  });
}
