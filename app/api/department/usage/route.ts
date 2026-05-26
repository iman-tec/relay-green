/*
 * GET /api/department/usage
 *
 * Department-scoped usage for the manager's reporting screen. Per-period
 * (last 6 months) totals with k-anonymity: a month with fewer than k
 * DISTINCT active members is suppressed. Scoped via requireDepartmentAdmin.
 *
 * TODO(api): synthetic spend (duration × €3/min) until a real ledger exists.
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";
import { isSuppressed, SUPPRESSED_LABEL } from "@/lib/relay/kanonymity";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const CENTS_PER_MINUTE = 300;

export async function GET() {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const { data: profs } = await admin
    .from("profiles")
    .select("id")
    .eq("department_id", departmentId);
  const ids = ((profs ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (ids.length === 0) return NextResponse.json({ byPeriod: [], perMinuteCents: CENTS_PER_MINUTE });

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  since.setDate(1); since.setHours(0, 0, 0, 0);

  const { data: rows } = await admin
    .from("guest_calls")
    .select("created_at, duration_minutes, customer_user_id, status")
    .in("customer_user_id", ids)
    .gte("created_at", since.toISOString());
  const sessions = (rows ?? []) as Array<{
    created_at: string; duration_minutes: number | null; customer_user_id: string | null; status: string;
  }>;

  type Bucket = { minutes: number; sessions: number; members: Set<string> };
  const byKey = new Map<string, Bucket>();
  for (const s of sessions) {
    if (s.status !== "ended" || !s.duration_minutes) continue;
    const d = new Date(s.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = byKey.get(key) ?? { minutes: 0, sessions: 0, members: new Set<string>() };
    b.minutes += Number(s.duration_minutes);
    b.sessions += 1;
    if (s.customer_user_id) b.members.add(s.customer_user_id);
    byKey.set(key, b);
  }

  const byPeriod = Array.from(byKey.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([period, b]) => {
      const memberCount = b.members.size;
      const suppressed = isSuppressed(memberCount, "periodSlice");
      return {
        period, memberCount, suppressed,
        minutes:    suppressed ? null : Math.round(b.minutes),
        sessions:   suppressed ? null : b.sessions,
        spendCents: suppressed ? null : Math.round(b.minutes * CENTS_PER_MINUTE),
        suppressedLabel: suppressed ? SUPPRESSED_LABEL : null,
      };
    });

  return NextResponse.json({ byPeriod, perMinuteCents: CENTS_PER_MINUTE });
}
