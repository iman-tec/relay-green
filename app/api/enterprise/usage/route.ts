/*
 * GET /api/enterprise/usage
 *
 * Aggregated usage for the enterprise reporting screen, scoped to the
 * caller's org, with k-anonymity applied to member-derived figures.
 *
 *   - byDepartment[]: per-department minutes/sessions. Suppressed when the
 *     department has fewer than k distinct members (context "department").
 *   - byPeriod[]: last 6 months of org usage. Each month suppressed when
 *     fewer than k DISTINCT members were active that month (context
 *     "periodSlice").
 *
 * Seat counts / department names / status are NOT member-derived usage and
 * are returned regardless of group size. See docs/gdpr-data-access-matrix.md.
 *
 * TODO(api): minutes come from the denormalized *_minutes counters + session
 * durations (synthetic ×300¢ billing). Swap to a real usage/billing ledger
 * when one exists.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { suppressValue, isSuppressed, SUPPRESSED_LABEL } from "@/lib/relay/kanonymity";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const CENTS_PER_MINUTE = 300;

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  // Departments in this org + their member counts.
  const { data: deptRows } = await admin
    .from("departments")
    .select("id, name, status, used_minutes, allocated_minutes")
    .eq("enterprise_id", orgId);
  const departments = (deptRows ?? []) as Array<{
    id: string; name: string; status: string;
    used_minutes: number | null; allocated_minutes: number | null;
  }>;

  // Member rosters (count distinct members per department) + org member ids.
  const { data: memberRows } = await admin
    .from("profiles")
    .select("id, department_id, client_type")
    .eq("organization_id", orgId);
  const members = (memberRows ?? []) as Array<{
    id: string; department_id: string | null; client_type: string | null;
  }>;
  const memberCountByDept = new Map<string, number>();
  for (const m of members) {
    if (!m.department_id) continue;
    memberCountByDept.set(m.department_id, (memberCountByDept.get(m.department_id) ?? 0) + 1);
  }
  const orgMemberIds = members.map((m) => m.id);

  // Per-department usage, k-anonymized on member count.
  const byDepartment = departments.map((d) => {
    const memberCount = memberCountByDept.get(d.id) ?? 0;
    const usedMin = Number(d.used_minutes ?? 0);
    const usage = suppressValue(
      {
        usedMinutes:  usedMin,
        allocatedMinutes: Number(d.allocated_minutes ?? 0),
        spendCents:   Math.round(usedMin * CENTS_PER_MINUTE),
      },
      memberCount,
      "department",
    );
    return {
      departmentId: d.id,
      name:         d.name,        // identity — always shown
      status:       d.status,      // not member-derived — always shown
      memberCount,                 // a count, not an individual figure
      suppressed:   usage.suppressed,
      usage:        usage.value,   // null when suppressed
      suppressedLabel: usage.suppressed ? SUPPRESSED_LABEL : null,
    };
  });

  // Per-period (last 6 calendar months) org usage, with distinct active
  // members per month for the k-anon gate.
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const orFilter = orgMemberIds.length > 0
    ? `organization_id.eq.${orgId},customer_user_id.in.(${orgMemberIds.join(",")})`
    : `organization_id.eq.${orgId}`;
  const { data: sessRows } = await admin
    .from("guest_calls")
    .select("created_at, duration_minutes, customer_user_id, status")
    .or(orFilter)
    .gte("created_at", since.toISOString());
  const sessions = (sessRows ?? []) as Array<{
    created_at: string; duration_minutes: number | null;
    customer_user_id: string | null; status: string;
  }>;

  type Bucket = { minutes: number; sessions: number; members: Set<string> };
  const byMonthKey = new Map<string, Bucket>();
  for (const s of sessions) {
    if (s.status !== "ended" || !s.duration_minutes) continue;
    const d = new Date(s.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = byMonthKey.get(key) ?? { minutes: 0, sessions: 0, members: new Set<string>() };
    b.minutes += Number(s.duration_minutes);
    b.sessions += 1;
    if (s.customer_user_id) b.members.add(s.customer_user_id);
    byMonthKey.set(key, b);
  }

  const byPeriod = Array.from(byMonthKey.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([period, b]) => {
      const memberCount = b.members.size;
      const suppressed = isSuppressed(memberCount, "periodSlice");
      return {
        period,
        memberCount,
        suppressed,
        minutes:    suppressed ? null : Math.round(b.minutes),
        sessions:   suppressed ? null : b.sessions,
        spendCents: suppressed ? null : Math.round(b.minutes * CENTS_PER_MINUTE),
        suppressedLabel: suppressed ? SUPPRESSED_LABEL : null,
      };
    });

  return NextResponse.json({ byDepartment, byPeriod, perMinuteCents: CENTS_PER_MINUTE });
}
