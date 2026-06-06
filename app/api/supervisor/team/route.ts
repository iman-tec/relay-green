/*
 * Supervisor's team roster.
 *
 * GET /api/supervisor/team
 *   Lists every engineer in the caller's pod. For each engineer:
 *     - displayName, email, primaryRole
 *     - currentCustomer: name of the guest on their active call (or null)
 *     - lastCallAt + lastCustomer: most recent completed session
 *
 *   Also returns `supervisors[]` for the pod (the assigned-supervisor
 *   column + capacity-meter slots): { userId, displayName, email, online,
 *   slotIndex }. Online state comes from supervisor_presence.is_online.
 *   The engineer → supervisor mapping itself lives in
 *   lib/allocation/podAllocation (a pass-through today).
 *
 * Gated to supervisors only. Super admins see other surfaces; the
 * supervisor's personal team roster doesn't apply to them.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";
import { distributeFreeEngineers } from "@/lib/allocation/podAllocation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIVE_STATES = ["live", "joining", "grace", "assigned"];

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  // Supervisor-only — super_admin is explicitly excluded, even if they
  // also hold supervisor from testing.
  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: "service_role_not_configured" },
      { status: 500 }
    );
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Find caller's pod (the pod where they're the supervisor).
  const { data: myMembership } = await admin
    .from("pod_members")
    .select("pod_id")
    .eq("user_id", user.id)
    .eq("pod_role", "supervisor")
    .maybeSingle();
  const podId = (myMembership as { pod_id?: string } | null)?.pod_id ?? null;
  if (!podId) return NextResponse.json({ pod: null, engineers: [] });

  const { data: pod } = await admin
    .from("pods")
    .select("id, name")
    .eq("id", podId)
    .maybeSingle();

  // 2. Engineers in the caller's OWN pod.
  const { data: members } = await admin
    .from("pod_members")
    .select("user_id")
    .eq("pod_id", podId)
    .eq("pod_role", "engineer");
  const ownEngineerIds = (members ?? []).map(
    (m: { user_id: string }) => m.user_id
  );

  // 2b. Cross-pod coverage. Pull the GLOBAL pod / supervisor map so we can work
  //     out which off-duty supervisors' engineers this on-duty supervisor is
  //     covering. Round-robin distribution lives in lib/allocation/podAllocation
  //     (read-time, deterministic, no cap). When the caller is off duty they
  //     cover nobody, so this collapses to "own pod only" — today's behavior.
  const [{ data: allPods }, { data: allMembers }, { data: presenceRows }] =
    await Promise.all([
      admin.from("pods").select("id, name").is("archived_at", null),
      admin
        .from("pod_members")
        .select("user_id, pod_id, pod_role")
        .in("pod_role", ["supervisor", "engineer"]),
      admin.from("supervisor_presence").select("user_id, is_online"),
    ]);

  const onlineByUser = new Map<string, boolean>();
  for (const r of (presenceRows ?? []) as {
    user_id: string;
    is_online: boolean;
  }[]) {
    onlineByUser.set(r.user_id, r.is_online);
  }
  const podNameById = new Map<string, string>();
  for (const p of (allPods ?? []) as { id: string; name: string }[]) {
    podNameById.set(p.id, p.name);
  }

  const memberRows = (allMembers ?? []) as {
    user_id: string;
    pod_id: string;
    pod_role: string;
  }[];
  const supMemberRows = memberRows.filter((m) => m.pod_role === "supervisor");
  const engMemberRows = memberRows.filter((m) => m.pod_role === "engineer");

  // Supervisor display names — used for the stable round-robin order, the
  // "Assigned supervisor" column, and the "Covering for X" label.
  const supervisorUserIds = supMemberRows.map((m) => m.user_id);
  const supNameById = new Map<string, string>();
  if (supervisorUserIds.length) {
    const { data: supProfiles } = await admin
      .from("profiles_with_role")
      .select("id, full_name")
      .in("id", supervisorUserIds);
    for (const p of (supProfiles ?? []) as {
      id: string;
      full_name: string | null;
    }[]) {
      supNameById.set(p.id, p.full_name ?? "Unnamed");
    }
  }

  const coverageSupervisors = supMemberRows.map((m) => ({
    userId: m.user_id,
    podId: m.pod_id,
    online: onlineByUser.get(m.user_id) ?? false,
    displayName: supNameById.get(m.user_id) ?? "Unnamed",
  }));
  const { assignment, uncovered } = distributeFreeEngineers({
    supervisors: coverageSupervisors,
    engineers: engMemberRows.map((m) => ({
      userId: m.user_id,
      podId: m.pod_id,
    })),
  });
  const coveredEngineerIds = assignment.get(user.id) ?? [];
  const callerOnDuty = onlineByUser.get(user.id) ?? false;

  // Each covered engineer's source pod + that pod's (off-duty) supervisor name,
  // for the "Covering — <pod>" grouping and assigned-supervisor column.
  const podIdByEngineer = new Map<string, string>();
  for (const m of engMemberRows) podIdByEngineer.set(m.user_id, m.pod_id);
  const supNameByPod = new Map<string, string>();
  for (const s of [...coverageSupervisors].sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  )) {
    if (!supNameByPod.has(s.podId)) supNameByPod.set(s.podId, s.displayName);
  }

  // Union of own + covered. Disjoint by construction (the caller's own pod has
  // an on-duty supervisor — the caller — so it is never a "free" pod). All the
  // enrichment below runs over this combined set, then we partition.
  const engineerIds = [...ownEngineerIds, ...coveredEngineerIds];
  if (engineerIds.length === 0) {
    return NextResponse.json({
      pod,
      engineers: [],
      coveredEngineers: [],
      supervisors: [],
      coverage: { coveredCount: 0, uncovered: uncovered.length, callerOnDuty },
    });
  }

  // 3. Profiles + emails (auth.users) + availability flag in one shot.
  const [{ data: profiles }, { data: authList }, { data: availRows }] =
    await Promise.all([
      admin
        .from("profiles_with_role")
        .select("id, full_name, primary_role")
        .in("id", engineerIds),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin
        .from("engineer_profiles")
        .select("user_id, is_available, presence_state, updated_at")
        .in("user_id", engineerIds),
    ]);

  // is_available is the engineer's explicit online/offline toggle (§3.2).
  // presence_state is the triple-state intent (online/busy/offline);
  // updated_at is the last presence change — used to show "Away · N min".
  const onlineById = new Map<string, boolean>();
  const presenceById = new Map<
    string,
    { state: string; since: string | null }
  >();
  for (const r of (availRows ?? []) as {
    user_id: string;
    is_available: boolean;
    presence_state: string | null;
    updated_at: string | null;
  }[]) {
    onlineById.set(r.user_id, r.is_available);
    presenceById.set(r.user_id, {
      state: r.presence_state ?? "offline",
      since: r.updated_at ?? null,
    });
  }

  const emailById = new Map<string, string>();
  for (const u of authList?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
  }

  // 4. Current live call + last completed call per engineer.
  //    We fetch in two queries scoped to the engineers we care about.
  const [{ data: liveCalls }, { data: pastCalls }] = await Promise.all([
    admin
      .from("guest_calls")
      .select("id, claimed_by, guest_name, created_at, status, assigned_at")
      .in("claimed_by", engineerIds)
      .in("status", LIVE_STATES)
      .order("created_at", { ascending: false }),
    admin
      .from("guest_calls")
      .select("id, claimed_by, guest_name, ended_at")
      .in("claimed_by", engineerIds)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(engineerIds.length * 4),
  ]);

  type CallRow = {
    id: string;
    claimed_by: string | null;
    guest_name: string | null;
  };
  type LiveCallRow = CallRow & {
    created_at: string;
    status: string;
    assigned_at: string | null;
  };
  const currentByEng = new Map<string, LiveCallRow>();
  for (const c of (liveCalls ?? []) as LiveCallRow[]) {
    if (c.claimed_by && !currentByEng.has(c.claimed_by))
      currentByEng.set(c.claimed_by, c);
  }

  // 5. Per-engineer 30-day KPI strip (build minutes + session count) and the
  //    live sentiment of the current call (latest_session_health), if any.
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const liveSessionIds = Array.from(currentByEng.values()).map((c) => c.id);
  const [{ data: kpiRows }, { data: healthRows }] = await Promise.all([
    admin
      .from("guest_calls")
      .select("claimed_by, duration_minutes")
      .in("claimed_by", engineerIds)
      .gte("created_at", since30),
    liveSessionIds.length
      ? admin
          .from("latest_session_health")
          .select("session_id, score, summary, message_count")
          .in("session_id", liveSessionIds)
      : Promise.resolve({
          data: [] as {
            session_id: string;
            score: number;
            summary: string;
            message_count: number;
          }[],
        }),
  ]);

  const kpiByEng = new Map<
    string,
    { buildMinutes: number; sessions: number }
  >();
  for (const r of (kpiRows ?? []) as {
    claimed_by: string | null;
    duration_minutes: number | null;
  }[]) {
    if (!r.claimed_by) continue;
    const k = kpiByEng.get(r.claimed_by) ?? { buildMinutes: 0, sessions: 0 };
    k.buildMinutes += Math.round(Number(r.duration_minutes ?? 0));
    k.sessions += 1;
    kpiByEng.set(r.claimed_by, k);
  }
  const healthBySession = new Map<
    string,
    { score: number; summary: string; messageCount: number }
  >();
  for (const h of (healthRows ?? []) as {
    session_id: string;
    score: number;
    summary: string;
    message_count: number;
  }[]) {
    healthBySession.set(h.session_id, {
      score: Number(h.score),
      summary: h.summary,
      messageCount: h.message_count,
    });
  }

  // Per-engineer go-live / maintain counts (E1/E2): distinct projects the
  // engineer worked, bucketed by projects.contract_type.
  const { data: engCalls } = await admin
    .from("guest_calls")
    .select("claimed_by, project_id")
    .in("claimed_by", engineerIds)
    .not("project_id", "is", null);
  const projByEng = new Map<string, Set<string>>();
  const allProjIds = new Set<string>();
  for (const c of (engCalls ?? []) as {
    claimed_by: string | null;
    project_id: string | null;
  }[]) {
    if (!c.claimed_by || !c.project_id) continue;
    if (!projByEng.has(c.claimed_by)) projByEng.set(c.claimed_by, new Set());
    projByEng.get(c.claimed_by)!.add(c.project_id);
    allProjIds.add(c.project_id);
  }
  const ctypeByProj = new Map<string, string>();
  if (allProjIds.size) {
    const { data: projTypes } = await admin
      .from("projects")
      .select("id, contract_type")
      .in("id", [...allProjIds]);
    for (const p of (projTypes ?? []) as {
      id: string;
      contract_type: string;
    }[])
      ctypeByProj.set(p.id, p.contract_type);
  }
  const engagementByEng = new Map<
    string,
    { golive: number; maintain: number }
  >();
  for (const [eng, pids] of projByEng) {
    let golive = 0,
      maintain = 0;
    for (const pid of pids) {
      const ct = ctypeByProj.get(pid);
      if (ct === "golive") golive++;
      else if (ct === "maintain") maintain++;
    }
    engagementByEng.set(eng, { golive, maintain });
  }

  const lastByEng = new Map<string, CallRow & { ended_at: string }>();
  for (const c of (pastCalls ?? []) as (CallRow & { ended_at: string })[]) {
    if (c.claimed_by && !lastByEng.has(c.claimed_by))
      lastByEng.set(c.claimed_by, c);
  }

  const engineers = (profiles ?? []).map(
    (p: {
      id: string;
      full_name: string | null;
      primary_role: string | null;
    }) => {
      const cur = currentByEng.get(p.id);
      const last = lastByEng.get(p.id);
      const pres = presenceById.get(p.id);
      const kpi = kpiByEng.get(p.id) ?? { buildMinutes: 0, sessions: 0 };
      const eng = engagementByEng.get(p.id) ?? { golive: 0, maintain: 0 };
      const sentiment = cur ? (healthBySession.get(cur.id) ?? null) : null;
      return {
        userId: p.id,
        displayName: p.full_name ?? "Unnamed",
        email: emailById.get(p.id) ?? "",
        primaryRole: p.primary_role ?? ROLE.engineer,
        presenceState: pres?.state ?? "offline",
        presenceSince: pres?.since ?? null,
        currentCustomer: cur?.guest_name ?? null,
        currentSessionId: cur?.id ?? null,
        currentStatus: cur?.status ?? null,
        onCallSince: cur?.assigned_at ?? cur?.created_at ?? null,
        buildMinutes: kpi.buildMinutes,
        sessions30d: kpi.sessions,
        golive: eng.golive,
        maintain: eng.maintain,
        liveSentiment: sentiment,
        lastCustomer: last?.guest_name ?? null,
        lastCallAt: last?.ended_at ?? null,
        isOnline: onlineById.get(p.id) ?? null,
      };
    }
  );

  engineers.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Partition the enriched rows: the caller's own pod vs the engineers they are
  // covering for off-duty supervisors. (Disjoint sets — see the union above.)
  const ownSet = new Set(ownEngineerIds);
  const coveredSet = new Set(coveredEngineerIds);
  const ownEngineers = engineers.filter((e) => ownSet.has(e.userId));
  const coveredEngineers = engineers
    .filter((e) => coveredSet.has(e.userId))
    .map((e) => {
      const fromPodId = podIdByEngineer.get(e.userId) ?? null;
      return {
        ...e,
        coveredFromPodId: fromPodId,
        coveredFromPodName: fromPodId
          ? (podNameById.get(fromPodId) ?? null)
          : null,
        coveredFromSupervisorName: fromPodId
          ? (supNameByPod.get(fromPodId) ?? null)
          : null,
      };
    });

  // Own-pod supervisors → "Assigned supervisor" column for own engineers + the
  // left capacity-meter slot. Derived from the global map (online =
  // supervisor_presence.is_online); email is reused from the enrichment fetch.
  const supervisors = coverageSupervisors
    .filter((s) => s.podId === podId)
    .map((s) => ({
      userId: s.userId,
      displayName: s.displayName,
      email: emailById.get(s.userId) ?? "",
      online: s.online,
    }))
    // Stable order so slot 0 / slot 1 don't flip between 5s polls.
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((s, i) => ({ ...s, slotIndex: i }));

  return NextResponse.json({
    pod,
    engineers: ownEngineers,
    coveredEngineers,
    supervisors,
    coverage: {
      coveredCount: coveredEngineers.length,
      uncovered: uncovered.length,
      callerOnDuty,
    },
  });
}
