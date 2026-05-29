/*
 * Enterprise admin's own-org snapshot.
 *
 * GET /api/enterprise/me
 *   Returns the caller's organization (id, name, code, status, created_at)
 *   + scoped KPI counts: staff, users, sessions in last 7 days,
 *     sessions in last 30 days, total spend this month, avg call duration,
 *     activeInLast7Days (unique users with ≥1 session in 7d), liveNow.
 *
 * Caller must hold enterprise_admin.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { STAFF_ROLES as ALL_STAFF_ROLES } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const STAFF_ROLE_SET: ReadonlySet<string> = new Set(ALL_STAFF_ROLES);

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, primary_domain, status, enterprise_code, created_at, reseller_id, discount_pct, discount_until, retention_days")
    .eq("id", orgId)
    .single();
  if (orgErr || !org) {
    return NextResponse.json({ error: orgErr?.message ?? "Org not found." }, { status: 404 });
  }

  // Channel Partner who onboarded this org (non-editable, shown in Settings).
  let channelPartner: { name: string; discountPct: number } | null = null;
  const resellerId = (org as { reseller_id?: string | null }).reseller_id;
  if (resellerId) {
    const { data: res } = await admin
      .from("resellers")
      .select("name, commission")
      .eq("id", resellerId)
      .maybeSingle();
    if (res) {
      channelPartner = {
        name: (res as { name: string }).name,
        discountPct: Number((res as { commission: number }).commission ?? 0),
      };
    }
  }

  // Users + staff in this org. profiles.organization_id is the bind.
  // Role split: anyone holding a staff role (everything except `client`) is
  // counted as staff; everyone else is a "user".
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", orgId);
  const profileIds = (profiles ?? []).map((p) => p.id as string);

  let staffCount = 0;
  let userCount  = profileIds.length;
  if (profileIds.length > 0) {
    const { data: roleRows } = await admin
      .from("user_role_names")
      .select("user_id, role")
      .in("user_id", profileIds);
    const staffSet = new Set<string>();
    for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
      if (STAFF_ROLE_SET.has(r.role)) staffSet.add(r.user_id);
    }
    staffCount = staffSet.size;
    userCount  = profileIds.length - staffCount;
  }

  // Sessions scoped to this org. profiles already filtered to orgId so
  // sessions.customer_user_id ∈ profileIds is the org's session set.
  const now      = new Date();
  const dayAgo7  = new Date(now.getTime() - 7  * 86_400_000).toISOString();
  const dayAgo30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let sessions7  = 0;
  let sessions30 = 0;
  let activeIn7  = 0;
  let liveNow    = 0;
  let spendMonth = 0;
  let avgDuration = 0;

  // Use guest_calls.organization_id when present; fall back to filtering
  // by customer_user_id ∈ org profiles for sessions seeded before that
  // column was added.
  const orFilter = profileIds.length > 0
    ? `organization_id.eq.${orgId},customer_user_id.in.(${profileIds.join(",")})`
    : `organization_id.eq.${orgId}`;
  const { data: rows } = await admin
    .from("guest_calls")
    .select("id, status, created_at, duration_minutes, customer_user_id, organization_id")
    .or(orFilter)
    .gte("created_at", dayAgo30);

  const allRows = (rows ?? []) as Array<{
    status: string; created_at: string;
    duration_minutes: number | null;
    customer_user_id: string | null;
    organization_id: string | null;
  }>;

  // Per-minute rate used to derive spend from duration. Real billing
  // lives in credit_wallets / payment_events; this is a stand-in until
  // we wire that aggregation in.
  const CENTS_PER_MINUTE = 300;

  sessions30 = allRows.length;
  const usersIn7 = new Set<string>();
  let durSum = 0;
  let durCount = 0;
  for (const r of allRows) {
    if (r.created_at >= dayAgo7) {
      sessions7 += 1;
      if (r.customer_user_id) usersIn7.add(r.customer_user_id);
    }
    if (r.status === "live" || r.status === "joining" || r.status === "grace") {
      liveNow += 1;
    }
    if (r.created_at >= monthStart && r.duration_minutes) {
      spendMonth += Math.round(Number(r.duration_minutes) * CENTS_PER_MINUTE);
    }
    if (r.status === "ended" && r.duration_minutes) {
      durSum += Number(r.duration_minutes);
      durCount += 1;
    }
  }
  activeIn7 = usersIn7.size;
  avgDuration = durCount === 0 ? 0 : durSum / durCount;

  return NextResponse.json({
    org: {
      id:             org.id,
      name:           org.name,
      primaryDomain:  org.primary_domain,
      status:         org.status,
      enterpriseCode: org.enterprise_code,
      createdAt:      org.created_at,
      discountPct:    Number((org as { discount_pct?: number }).discount_pct ?? 0),
      discountUntil:  (org as { discount_until?: string | null }).discount_until ?? null,
      // 0 in the UI = "indefinite"; stored as NULL in the column.
      retentionDays:  Number((org as { retention_days?: number | null }).retention_days ?? 0),
    },
    channelPartner,
    kpis: {
      staffCount,
      userCount,
      sessions7Days:    sessions7,
      sessions30Days:   sessions30,
      activeIn7Days:    activeIn7,
      liveNow,
      spendMonthCents:  spendMonth,
      avgDurationMin:   Math.round(avgDuration * 10) / 10,
    },
  });
}
