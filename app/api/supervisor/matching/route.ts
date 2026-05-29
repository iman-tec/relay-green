/*
 * Live matching board — every offer currently being rung TO AN ENGINEER
 * IN THE CALLER'S POD. Supervisor-scoped: the supervisor sees only their
 * pod's ring traffic so the table doesn't expose other teams.
 *
 * GET /api/supervisor/matching
 *   Returns { rows: MatchingRow[], pod: { id, name } | null }
 *
 * Gated to users with the supervisor role and a pod_members row. Super
 * admins are not handled here yet — a separate /api/admin/matching will
 * be added later with the platform-wide global view.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export type MatchingRow = {
  offerId:        string | null;   // null for an all-declined stranded session
  intakeId:       string;
  guestCallId:    string | null;
  matchScore:     number;
  offeredAt:      string | null;
  expiresAt:      string | null;   // null when nobody is currently being rung
  /** True when every rung engineer declined/expired and the session is
   *  still queued with no one ringing — needs a manual assignment. */
  allDeclined:    boolean;
  engineer: {
    userId:          string | null;
    displayName:     string;
    email:           string;
    experienceLevel: string | null;
  };
  customer: {
    userId:      string | null;
    displayName: string;
  };
  projectName:    string | null;
  technologies:   string[];
  developing:     string | null;
  declinedBy:     { userId: string; displayName: string }[];
  queuedAt:       string | null;
};

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  // Supervisor-only. Super_admin is excluded — the global view is a
  // separate endpoint that doesn't ship yet.
  if (!roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Caller's pod — the same pod_members row that supervisor/team uses.
  const { data: myMembership } = await admin
    .from("pod_members")
    .select("pod_id")
    .eq("user_id", user.id)
    .eq("pod_role", "supervisor")
    .maybeSingle();
  const podId = (myMembership as { pod_id?: string } | null)?.pod_id ?? null;
  if (!podId) return NextResponse.json({ pod: null, rows: [] });

  const { data: pod } = await admin
    .from("pods")
    .select("id, name")
    .eq("id", podId)
    .maybeSingle();

  // 2. Engineers in that pod — these are the only engineer_user_id values
  //    we want to consider when reading offers.
  const { data: members } = await admin
    .from("pod_members")
    .select("user_id")
    .eq("pod_id", podId)
    .eq("pod_role", "engineer");
  const podEngineerIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (podEngineerIds.length === 0) {
    return NextResponse.json({ pod, rows: [] });
  }

  // 3. Pending offers currently being rung to one of those engineers. We
  //    intentionally include stale 'pending' rows whose expires_at has
  //    already passed — the advance_match trigger usually clears them
  //    within a second, but leaving them visible exposes the rare case
  //    where the sweep lags.
  // 3b. ALSO recently-closed (declined/expired) offers to those engineers,
  //     so we can surface sessions this pod rang that NOBODY took — they'd
  //     otherwise vanish from the board the moment the last engineer
  //     declines, leaving the supervisor blind to a still-waiting customer.
  const [pendRes, closedRes] = await Promise.all([
    admin
      .from("engineer_match_offers")
      .select("id, intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score, offered_at, expires_at")
      .eq("status", "pending")
      .in("engineer_user_id", podEngineerIds)
      .order("expires_at", { ascending: true }),
    admin
      .from("engineer_match_offers")
      .select("intake_id, guest_call_id")
      .in("status", ["declined", "expired"])
      .in("engineer_user_id", podEngineerIds)
      .order("offered_at", { ascending: false })
      .limit(300),
  ]);
  if (pendRes.error) {
    return NextResponse.json({ error: pendRes.error.message }, { status: 500 });
  }

  type Offer = {
    id:                string;
    intake_id:         string;
    guest_call_id:     string | null;
    engineer_user_id:  string;
    customer_user_id:  string | null;
    match_score:       number;
    offered_at:        string;
    expires_at:        string;
  };
  const typedOffers = (pendRes.data ?? []) as Offer[];
  const pendingIntakeIds = new Set(typedOffers.map((o) => o.intake_id));

  // Candidate stranded intakes: rang then closed, with no live pending ring.
  // We confirm "still queued / unclaimed" against guest_calls below.
  const strandedCandidates = new Map<string, string | null>(); // intake_id → guest_call_id
  for (const c of (closedRes.data ?? []) as { intake_id: string; guest_call_id: string | null }[]) {
    if (!pendingIntakeIds.has(c.intake_id) && !strandedCandidates.has(c.intake_id)) {
      strandedCandidates.set(c.intake_id, c.guest_call_id);
    }
  }

  if (typedOffers.length === 0 && strandedCandidates.size === 0) {
    return NextResponse.json({ pod, rows: [] });
  }

  const intakeIds    = Array.from(new Set([...typedOffers.map((o) => o.intake_id), ...strandedCandidates.keys()]));
  const guestCallIds = Array.from(new Set([
    ...typedOffers.map((o) => o.guest_call_id),
    ...strandedCandidates.values(),
  ].filter((id): id is string => !!id)));
  const engineerIds  = Array.from(new Set(typedOffers.map((o) => o.engineer_user_id)));

  // 4. Intake, session, engineer profile rows for enrichment.
  const [intakesRes, callsRes, engProfilesRes] = await Promise.all([
    admin
      .from("client_intakes")
      .select("id, project_id, technologies, developing, declined_by, customer_user_id, created_at")
      .in("id", intakeIds),
    guestCallIds.length
      ? admin
          .from("guest_calls")
          .select("id, project_name, guest_name, created_at, status, claimed_by")
          .in("id", guestCallIds)
      : Promise.resolve({ data: [] as unknown[] }),
    admin
      .from("engineer_profiles")
      .select("user_id, experience_level")
      .in("user_id", engineerIds),
  ]);

  type Intake = {
    id:               string;
    project_id:       string | null;
    technologies:     string[];
    developing:       string | null;
    declined_by:      string[];
    customer_user_id: string | null;
    created_at:       string;
  };
  type Call = {
    id:           string;
    project_name: string | null;
    guest_name:   string | null;
    created_at:   string;
    status:       string;
    claimed_by:   string | null;
  };
  type EngProfile = { user_id: string; experience_level: string | null };

  const intakes      = (intakesRes.data     ?? []) as Intake[];
  const calls        = (callsRes.data       ?? []) as Call[];
  const engProfiles  = (engProfilesRes.data ?? []) as EngProfile[];

  const intakeById     = new Map(intakes.map((r) => [r.id, r]));
  const callById       = new Map(calls.map((r) => [r.id, r]));
  const engProfileById = new Map(engProfiles.map((r) => [r.user_id, r]));

  // 5. Resolve every user mentioned (engineer, customer, declined-by).
  const allUserIds = new Set<string>();
  for (const o of typedOffers) {
    allUserIds.add(o.engineer_user_id);
    if (o.customer_user_id) allUserIds.add(o.customer_user_id);
  }
  for (const intake of intakes) {
    if (intake.customer_user_id) allUserIds.add(intake.customer_user_id);
    for (const id of intake.declined_by ?? []) allUserIds.add(id);
  }

  const userIds = Array.from(allUserIds);
  const [profilesRes, authListRes] = await Promise.all([
    userIds.length
      ? admin.from("profiles_with_role").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as unknown[] }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  type ProfileRow = { id: string; full_name: string | null };
  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const nameById = new Map<string, string>();
  const emailById = new Map<string, string>();
  for (const p of profiles) {
    if (p.full_name) nameById.set(p.id, p.full_name);
  }
  for (const u of authListRes?.data?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
    if (u.id && !nameById.has(u.id) && u.email) {
      nameById.set(u.id, u.email.split("@")[0]);
    }
  }
  const displayNameFor = (id: string | null | undefined): string => {
    if (!id) return "—";
    return nameById.get(id) ?? "Unknown";
  };

  const rows: MatchingRow[] = typedOffers.map((o) => {
    const intake     = intakeById.get(o.intake_id);
    const call       = o.guest_call_id ? callById.get(o.guest_call_id) : undefined;
    const engProfile = engProfileById.get(o.engineer_user_id);
    const customerId = o.customer_user_id ?? intake?.customer_user_id ?? null;
    return {
      offerId:     o.id,
      intakeId:    o.intake_id,
      guestCallId: o.guest_call_id,
      matchScore:  Number(o.match_score),
      offeredAt:   o.offered_at,
      expiresAt:   o.expires_at,
      allDeclined: false,
      engineer: {
        userId:          o.engineer_user_id,
        displayName:     displayNameFor(o.engineer_user_id),
        email:           emailById.get(o.engineer_user_id) ?? "",
        experienceLevel: engProfile?.experience_level ?? null,
      },
      customer: {
        userId:      customerId,
        displayName: customerId ? displayNameFor(customerId) : (call?.guest_name ?? "Guest"),
      },
      projectName:  call?.project_name ?? null,
      technologies: intake?.technologies ?? [],
      developing:   intake?.developing ?? null,
      declinedBy:   (intake?.declined_by ?? []).map((uid) => ({
        userId:      uid,
        displayName: displayNameFor(uid),
      })),
      queuedAt:     call?.created_at ?? intake?.created_at ?? null,
    };
  });

  // Stranded sessions: this pod rang them, every engineer declined/expired,
  // and the session is STILL queued + unclaimed. Surface one row each so the
  // supervisor can see "all declined" and assign manually, instead of the
  // board going blank the moment the last engineer declines.
  for (const [intakeId, gcId] of strandedCandidates) {
    const call   = gcId ? callById.get(gcId) : undefined;
    // Only truly-waiting sessions: still queued and not claimed by anyone.
    if (!call || call.status !== "queued" || call.claimed_by) continue;
    const intake     = intakeById.get(intakeId);
    const customerId = intake?.customer_user_id ?? null;
    rows.push({
      offerId:     null,
      intakeId,
      guestCallId: gcId,
      matchScore:  0,
      offeredAt:   null,
      expiresAt:   null,
      allDeclined: true,
      engineer: { userId: null, displayName: "All declined", email: "", experienceLevel: null },
      customer: {
        userId:      customerId,
        displayName: customerId ? displayNameFor(customerId) : (call.guest_name ?? "Guest"),
      },
      projectName:  call.project_name ?? null,
      technologies: intake?.technologies ?? [],
      developing:   intake?.developing ?? null,
      declinedBy:   (intake?.declined_by ?? []).map((uid) => ({
        userId:      uid,
        displayName: displayNameFor(uid),
      })),
      queuedAt:     call.created_at ?? intake?.created_at ?? null,
    });
  }

  // All-declined sessions float to the top — they're the ones needing action.
  rows.sort((a, b) => (a.allDeclined === b.allDeclined ? 0 : a.allDeclined ? -1 : 1));

  return NextResponse.json({ pod, rows });
}
