/*
 * Channel Partner command-center payload — powers the KPI ribbon + the single
 * Companies table in the reimagined /reseller portal.
 *
 * GET /api/reseller/portal
 *   {
 *     reseller: { id, name, code, tier, commission, defaultPassthroughPct },
 *     ribbon:   { activeCompanies, minutesThisMonth, spendThisMonthCents,
 *                 balanceDueCents, earnedLifetimeCents, paidLifetimeCents },
 *     companies: [ { id, name, code, partnerStatus, status, discountPct,
 *                    minutesThisMonth, spendThisMonthCents, earnedLifetimeCents,
 *                    onboardedAt, lastActivityAt } ]
 *   }
 *
 * Accounting basis (locked decisions):
 *   - "spend" = the enterprise's NET billed usage = used minutes × list rate ×
 *     (1 − passthrough), i.e. the effective rate after the partner discount.
 *   - "earned" accrues per unit of billed usage at the net margin
 *     (wholesale − passthrough), per lib/billing/partnerMargin. Computed
 *     read-only from usage — it does NOT touch any money/recharge path.
 *   - "balance due" = earned-to-date − paid-out (partner_payouts.paid_cents).
 *
 * Flag-gated: reads partner-program columns (partner_status, tier, …) that only
 * exist once the program migration is applied, so it 404s when the flag is off.
 * Caller must hold the `reseller` role.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { laterIso } from "@/lib/relay/memberStatus";
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";
import { LIST_CENTS_PER_MINUTE } from "@/lib/billing/minuteBundles";
import {
  effectiveBundleCents,
  partnerEarnedCents,
} from "@/lib/billing/partnerMargin";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export async function GET() {
  if (!partnerProgramEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  // Reseller header + the partner's companies + their payout ledger.
  const [
    { data: r, error: rErr },
    { data: orgs, error: oErr },
    { data: payouts },
  ] = await Promise.all([
    admin
      .from("resellers")
      .select(
        "id, name, reseller_code, tier, commission, default_passthrough_pct"
      )
      .eq("id", resellerId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select(
        "id, name, enterprise_code, status, partner_status, discount_pct, discount_until, onboarded_at, used_minutes"
      )
      .eq("reseller_id", resellerId)
      .order("onboarded_at", { ascending: false }),
    admin
      .from("partner_payouts")
      .select("paid_cents")
      .eq("reseller_id", resellerId),
  ]);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!r)
    return NextResponse.json(
      { error: "reseller row missing" },
      { status: 500 }
    );

  const reseller = r as {
    id: string;
    name: string;
    reseller_code: string;
    tier: string;
    commission: number;
    default_passthrough_pct: number;
  };
  const commission = Number(reseller.commission ?? 0);

  const companies = (orgs ?? []) as Array<{
    id: string;
    name: string;
    enterprise_code: string;
    status: string;
    partner_status: string | null;
    discount_pct: number | null;
    discount_until: string | null;
    onboarded_at: string | null;
    used_minutes: number | null;
  }>;
  const orgIds = companies.map((c) => c.id);

  // Per-company usage this month + last activity, aggregated from ended
  // sessions. One query for all the partner's orgs; bucketed in JS.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const monthMinByOrg = new Map<string, number>();
  const lastActivityByOrg = new Map<string, string>();
  // Last LOGIN per org (auth.users.last_sign_in_at, max across the org's
  // profiles) — the real "last activity" signal: an org whose admin has signed
  // in shows a timestamp even before any session. "—" only when truly never.
  const lastLoginByOrg = new Map<string, string>();
  // Admin identity per company — email + name from the enterprise_admin invite
  // recorded at onboarding (keyed to org by company name, newest wins), with
  // the org's enterprise_admin profile name as fallback when no invite matches.
  const adminByCompany = new Map<
    string,
    { name: string | null; email: string }
  >();
  const adminNameByOrg = new Map<string, string>();

  if (orgIds.length > 0) {
    const [{ data: invRows }, { data: profRows }] = await Promise.all([
      admin
        .from("invites")
        .select("email, name, company_name, sent_at")
        .eq("scope_type", "partner")
        .eq("scope_id", resellerId)
        .eq("role", ROLE.enterprise_admin)
        .order("sent_at", { ascending: true }),
      admin
        .from("profiles_with_role")
        .select("id, organization_id, full_name, primary_role")
        .in("organization_id", orgIds),
    ]);

    for (const row of (invRows ?? []) as Array<{
      email: string;
      name: string | null;
      company_name: string | null;
      sent_at: string;
    }>) {
      const key = normName(row.company_name);
      if (key) adminByCompany.set(key, { name: row.name, email: row.email });
    }

    // Member profiles serve two jobs: session attribution (below) and the
    // admin-name fallback.
    const profiles = (profRows ?? []) as Array<{
      id: string;
      organization_id: string | null;
      full_name: string | null;
      primary_role: string | null;
    }>;
    const orgOfProfile = new Map<string, string>();
    for (const p of profiles) {
      if (p.organization_id) orgOfProfile.set(p.id, p.organization_id);
      if (
        p.organization_id &&
        p.primary_role === ROLE.enterprise_admin &&
        p.full_name?.trim() &&
        !adminNameByOrg.has(p.organization_id)
      ) {
        adminNameByOrg.set(p.organization_id, p.full_name.trim());
      }
    }

    // Sessions attach to an org EITHER directly (guest_calls.organization_id)
    // OR via the member who placed them (customer_user_id ∈ the org's
    // profiles). organization_id is effectively never populated, so matching it
    // alone under-reports minutes + last-activity to zero — resolve members and
    // attribute each session through them.
    const memberIds = profiles.map((p) => p.id);
    const orParts = [`organization_id.in.(${orgIds.join(",")})`];
    if (memberIds.length > 0) {
      orParts.push(`customer_user_id.in.(${memberIds.join(",")})`);
    }
    const { data: sessions } = await admin
      .from("guest_calls")
      .select(
        "organization_id, customer_user_id, status, duration_minutes, created_at"
      )
      .or(orParts.join(","));

    for (const s of (sessions ?? []) as Array<{
      organization_id: string | null;
      customer_user_id: string | null;
      status: string;
      duration_minutes: number | null;
      created_at: string;
    }>) {
      const oid =
        s.organization_id ??
        (s.customer_user_id ? orgOfProfile.get(s.customer_user_id) : undefined);
      if (!oid) continue;
      const prevLast = lastActivityByOrg.get(oid);
      if (!prevLast || s.created_at > prevLast)
        lastActivityByOrg.set(oid, s.created_at);
      if (s.status !== "ended" || !s.duration_minutes) continue;
      if (new Date(s.created_at) >= monthStart) {
        monthMinByOrg.set(
          oid,
          (monthMinByOrg.get(oid) ?? 0) + Number(s.duration_minutes)
        );
      }
    }

    // Last login per org — max last_sign_in_at across the org's profiles.
    const { data: authPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of authPage?.users ?? []) {
      if (!u.id || !u.last_sign_in_at) continue;
      const oid = orgOfProfile.get(u.id);
      if (!oid) continue;
      const prev = lastLoginByOrg.get(oid);
      if (!prev || u.last_sign_in_at > prev)
        lastLoginByOrg.set(oid, u.last_sign_in_at);
    }
  }

  const rows = companies.map((c) => {
    const discountPct = Number(c.discount_pct ?? 0);
    const minutesThisMonth = monthMinByOrg.get(c.id) ?? 0;
    const lifetimeMinutes = Number(c.used_minutes ?? 0);

    // Net spend = usage valued at the effective (discounted) rate. Both windows.
    const spendThisMonthCents = effectiveBundleCents(
      Math.round(minutesThisMonth * LIST_CENTS_PER_MINUTE),
      discountPct,
      c.discount_until
    );
    const spendLifetimeCents = effectiveBundleCents(
      Math.round(lifetimeMinutes * LIST_CENTS_PER_MINUTE),
      discountPct,
      c.discount_until
    );
    // Earned-to-date = net margin over lifetime billed usage.
    const earnedLifetimeCents = partnerEarnedCents({
      listAmountCents: Math.round(lifetimeMinutes * LIST_CENTS_PER_MINUTE),
      wholesalePct: commission,
      passthroughPct: discountPct,
    });

    return {
      id: c.id,
      name: c.name,
      code: c.enterprise_code,
      partnerStatus: c.partner_status,
      status: c.status,
      discountPct,
      minutesThisMonth,
      minutesLifetime: lifetimeMinutes,
      spendThisMonthCents,
      spendLifetimeCents,
      earnedLifetimeCents,
      onboardedAt: c.onboarded_at,
      // Most recent of last-login and last-session; "—" only when neither.
      lastActivityAt: laterIso(
        lastLoginByOrg.get(c.id) ?? null,
        lastActivityByOrg.get(c.id) ?? null
      ),
      adminName:
        adminByCompany.get(normName(c.name))?.name ??
        adminNameByOrg.get(c.id) ??
        null,
      adminEmail: adminByCompany.get(normName(c.name))?.email ?? null,
    };
  });

  const earnedLifetimeCents = rows.reduce(
    (a, b) => a + b.earnedLifetimeCents,
    0
  );
  const paidLifetimeCents = (
    (payouts ?? []) as Array<{ paid_cents: number }>
  ).reduce((a, b) => a + Number(b.paid_cents ?? 0), 0);

  return NextResponse.json({
    reseller: {
      id: reseller.id,
      name: reseller.name,
      code: reseller.reseller_code,
      tier: reseller.tier ?? "partner",
      commission,
      defaultPassthroughPct: Number(reseller.default_passthrough_pct ?? 0),
    },
    ribbon: {
      totalCompanies: rows.length,
      activeCompanies: rows.filter((c) => c.partnerStatus === "active").length,
      minutesThisMonth: rows.reduce((a, b) => a + b.minutesThisMonth, 0),
      minutesLifetime: rows.reduce((a, b) => a + b.minutesLifetime, 0),
      spendThisMonthCents: rows.reduce((a, b) => a + b.spendThisMonthCents, 0),
      spendLifetimeCents: rows.reduce((a, b) => a + b.spendLifetimeCents, 0),
      earnedLifetimeCents,
      paidLifetimeCents,
      balanceDueCents: earnedLifetimeCents - paidLifetimeCents,
    },
    companies: rows,
  });
}
