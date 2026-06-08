/*
 * GET /api/department/usage
 *
 * Department-scoped usage for the manager's reporting screen. Returns:
 *   - byMember : per-employee sessions / minutes / spend / last session / live-now
 *                + email (allowed metadata) + dormant flag. (Own-dept members,
 *                so names + email are permitted — see GDPR matrix.)
 *   - byProject: sessions / minutes per project label (metadata).
 *   - byPeriod : last-6-months trend, k-anonymity suppressed.
 *   - budget   : dept allocated / used / left + a daily-burn RUNWAY ESTIMATE.
 *   - totalLiveNow : members currently in a live/joining/grace session.
 *
 * Metadata-only: NO session content (no transcripts, summaries, sentiment).
 * Scoped via requireDepartmentAdmin (own department).
 *
 * TODO(api): synthetic spend (duration × €3/min) until a real ledger exists —
 * the runway is an ESTIMATE, not tied to billing.
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";
import { isSuppressed, SUPPRESSED_LABEL } from "@/lib/relay/kanonymity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CENTS_PER_MINUTE = 300;
const LIVE_STATES = new Set(["live", "joining", "grace"]);

export async function GET() {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  // Department members (employees only — exclude the admin's own profile).
  const { data: profs } = await admin
    .from("profiles")
    .select(
      "id, full_name, status, used_minutes, remaining_minutes, allocated_minutes"
    )
    .eq("department_id", departmentId)
    .eq("client_type", "employee");
  const members = (profs ?? []) as Array<{
    id: string;
    full_name: string | null;
    status: string | null;
    used_minutes: number | null;
    remaining_minutes: number | null;
    allocated_minutes: number | null;
  }>;
  const ids = members.map((p) => p.id);

  // Department allocation (budget).
  const { data: deptRow } = await admin
    .from("departments")
    .select("allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", departmentId)
    .maybeSingle();
  const allocated = Number(
    (deptRow as { allocated_minutes?: number } | null)?.allocated_minutes ?? 0
  );
  const usedDept = Number(
    (deptRow as { used_minutes?: number } | null)?.used_minutes ?? 0
  );
  const remaining = Number(
    (deptRow as { remaining_minutes?: number } | null)?.remaining_minutes ?? 0
  );

  const emptyBudget = {
    allocatedMinutes: allocated,
    usedMinutes: usedDept,
    remainingMinutes: remaining,
    spendToDateCents: Math.round(usedDept * CENTS_PER_MINUTE),
    dailyBurnMinutes: 0,
    runoutDays: null as number | null,
    runoutDate: null as string | null,
    estimate: true,
  };

  if (ids.length === 0)
    return NextResponse.json({
      byMember: [],
      byProject: [],
      byPeriod: [],
      budget: emptyBudget,
      totalLiveNow: 0,
      perMinuteCents: CENTS_PER_MINUTE,
    });

  // Emails + last sign-in (allowed metadata for the admin's own-dept members).
  const authBy = new Map<string, { email: string; lastSignIn: string | null }>();
  const { data: authPage } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  for (const u of authPage?.users ?? []) {
    if (ids.includes(u.id))
      authBy.set(u.id, {
        email: u.email ?? "",
        lastSignIn: u.last_sign_in_at ?? null,
      });
  }

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const { data: rows } = await admin
    .from("guest_calls")
    .select("created_at, duration_minutes, customer_user_id, status, project_name")
    .in("customer_user_id", ids)
    .gte("created_at", since.toISOString());
  const sessions = (rows ?? []) as Array<{
    created_at: string;
    duration_minutes: number | null;
    customer_user_id: string | null;
    status: string;
    project_name: string | null;
  }>;

  // ---- byPeriod (monthly trend, k-anonymity) -------------------------------
  type Bucket = { minutes: number; sessions: number; members: Set<string> };
  const byKey = new Map<string, Bucket>();
  for (const s of sessions) {
    if (s.status !== "ended" || !s.duration_minutes) continue;
    const d = new Date(s.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = byKey.get(key) ?? {
      minutes: 0,
      sessions: 0,
      members: new Set<string>(),
    };
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
        period,
        memberCount,
        suppressed,
        minutes: suppressed ? null : Math.round(b.minutes),
        sessions: suppressed ? null : b.sessions,
        spendCents: suppressed ? null : Math.round(b.minutes * CENTS_PER_MINUTE),
        suppressedLabel: suppressed ? SUPPRESSED_LABEL : null,
      };
    });

  // ---- byMember ------------------------------------------------------------
  type MAgg = {
    sessions: number;
    minutes: number;
    lastAt: string | null;
    live: boolean;
  };
  const mAgg = new Map<string, MAgg>();
  const d30 = new Date();
  d30.setDate(d30.getDate() - 30);
  let last30Min = 0;
  for (const s of sessions) {
    const uid = s.customer_user_id;
    if (!uid) continue;
    const m = mAgg.get(uid) ?? {
      sessions: 0,
      minutes: 0,
      lastAt: null,
      live: false,
    };
    if (s.status === "ended" && s.duration_minutes) {
      m.sessions += 1;
      m.minutes += Number(s.duration_minutes);
      if (new Date(s.created_at) >= d30) last30Min += Number(s.duration_minutes);
    }
    if (LIVE_STATES.has(s.status)) m.live = true;
    if (!m.lastAt || s.created_at > m.lastAt) m.lastAt = s.created_at;
    mAgg.set(uid, m);
  }

  const byMember = members
    .map((p) => {
      const a = authBy.get(p.id);
      const m = mAgg.get(p.id);
      const mins = m?.minutes ?? 0;
      return {
        id: p.id,
        name: p.full_name ?? "",
        email: a?.email ?? "",
        status: p.status ?? "active",
        sessions: m?.sessions ?? 0,
        minutes: Math.round(mins),
        spendCents: Math.round(mins * CENTS_PER_MINUTE),
        remainingMinutes: Number(p.remaining_minutes ?? 0),
        lastSessionAt: m?.lastAt ?? null,
        lastSignIn: a?.lastSignIn ?? null,
        liveNow: m?.live ?? false,
        dormant: (m?.sessions ?? 0) === 0,
      };
    })
    .sort(
      (x, y) =>
        Number(y.liveNow) - Number(x.liveNow) || y.sessions - x.sessions
    );

  const totalLiveNow = byMember.filter((m) => m.liveNow).length;

  // ---- byProject -----------------------------------------------------------
  const pAgg = new Map<string, { sessions: number; minutes: number }>();
  for (const s of sessions) {
    if (s.status !== "ended" || !s.duration_minutes) continue;
    const key = s.project_name?.trim() || "Untitled";
    const pa = pAgg.get(key) ?? { sessions: 0, minutes: 0 };
    pa.sessions += 1;
    pa.minutes += Number(s.duration_minutes);
    pAgg.set(key, pa);
  }
  const byProject = Array.from(pAgg.entries())
    .map(([project, v]) => ({
      project,
      sessions: v.sessions,
      minutes: Math.round(v.minutes),
      spendCents: Math.round(v.minutes * CENTS_PER_MINUTE),
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // ---- budget + runway estimate -------------------------------------------
  const dailyBurn = last30Min / 30;
  const runoutDays = dailyBurn > 0 ? Math.round(remaining / dailyBurn) : null;
  let runoutDate: string | null = null;
  if (runoutDays != null) {
    const dd = new Date();
    dd.setDate(dd.getDate() + runoutDays);
    runoutDate = dd.toISOString();
  }
  const budget = {
    allocatedMinutes: allocated,
    usedMinutes: usedDept,
    remainingMinutes: remaining,
    spendToDateCents: Math.round(usedDept * CENTS_PER_MINUTE),
    dailyBurnMinutes: Math.round(dailyBurn * 10) / 10,
    runoutDays,
    runoutDate,
    estimate: true,
  };

  return NextResponse.json({
    byMember,
    byProject,
    byPeriod,
    budget,
    totalLiveNow,
    perMinuteCents: CENTS_PER_MINUTE,
  });
}
