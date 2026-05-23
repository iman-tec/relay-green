/*
 * Global live matching board — every offer currently being rung across
 * every pod. Super_admin only. Mirrors /api/supervisor/matching but
 * adds a per-row `pod` field so the admin can see which team owns each
 * engineer that's being rung.
 *
 * GET /api/admin/matching
 *   Returns { rows: AdminMatchingRow[] }
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export type AdminMatchingRow = {
  offerId:        string;
  intakeId:       string;
  guestCallId:    string | null;
  matchScore:     number;
  offeredAt:      string;
  expiresAt:      string;
  engineer: {
    userId:          string;
    displayName:     string;
    email:           string;
    experienceLevel: string | null;
  };
  pod: {
    id:   string;
    name: string;
  } | null;
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
  if (!roles.includes(ROLE.super_admin)) {
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

  // 1. Every pending offer, platform-wide.
  const { data: offers, error: offersErr } = await admin
    .from("engineer_match_offers")
    .select("id, intake_id, guest_call_id, engineer_user_id, customer_user_id, match_score, offered_at, expires_at")
    .eq("status", "pending")
    .order("expires_at", { ascending: true });
  if (offersErr) {
    return NextResponse.json({ error: offersErr.message }, { status: 500 });
  }
  if (!offers || offers.length === 0) {
    return NextResponse.json({ rows: [] });
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
  const typedOffers = offers as Offer[];

  const intakeIds    = Array.from(new Set(typedOffers.map((o) => o.intake_id)));
  const guestCallIds = Array.from(new Set(typedOffers.map((o) => o.guest_call_id).filter((id): id is string => !!id)));
  const engineerIds  = Array.from(new Set(typedOffers.map((o) => o.engineer_user_id)));

  // 2. Intake, session, engineer profile, and pod-membership rows in
  //    parallel. pod_members + pods give us the engineer's team.
  const [intakesRes, callsRes, engProfilesRes, podMemRes] = await Promise.all([
    admin
      .from("client_intakes")
      .select("id, project_id, technologies, developing, declined_by, customer_user_id, created_at")
      .in("id", intakeIds),
    guestCallIds.length
      ? admin
          .from("guest_calls")
          .select("id, project_name, guest_name, created_at")
          .in("id", guestCallIds)
      : Promise.resolve({ data: [] as unknown[] }),
    admin
      .from("engineer_profiles")
      .select("user_id, experience_level")
      .in("user_id", engineerIds),
    admin
      .from("pod_members")
      .select("user_id, pod_id")
      .eq("pod_role", "engineer")
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
  };
  type EngProfile = { user_id: string; experience_level: string | null };
  type PodMember = { user_id: string; pod_id: string };

  const intakes      = (intakesRes.data     ?? []) as Intake[];
  const calls        = (callsRes.data       ?? []) as Call[];
  const engProfiles  = (engProfilesRes.data ?? []) as EngProfile[];
  const podMems      = (podMemRes.data      ?? []) as PodMember[];

  const intakeById      = new Map(intakes.map((r) => [r.id, r]));
  const callById        = new Map(calls.map((r) => [r.id, r]));
  const engProfileById  = new Map(engProfiles.map((r) => [r.user_id, r]));
  const podIdByEngineer = new Map(podMems.map((r) => [r.user_id, r.pod_id]));

  // 3. Pod display names for any pod that showed up in step 2.
  const podIds = Array.from(new Set(podMems.map((m) => m.pod_id)));
  let podById = new Map<string, { id: string; name: string }>();
  if (podIds.length) {
    const { data: pods } = await admin.from("pods").select("id, name").in("id", podIds);
    type Pod = { id: string; name: string };
    podById = new Map(((pods ?? []) as Pod[]).map((p) => [p.id, p]));
  }

  // 4. User name + email resolution (engineer, customer, declined-by).
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

  const rows: AdminMatchingRow[] = typedOffers.map((o) => {
    const intake     = intakeById.get(o.intake_id);
    const call       = o.guest_call_id ? callById.get(o.guest_call_id) : undefined;
    const engProfile = engProfileById.get(o.engineer_user_id);
    const customerId = o.customer_user_id ?? intake?.customer_user_id ?? null;
    const podId      = podIdByEngineer.get(o.engineer_user_id) ?? null;
    const pod        = podId ? podById.get(podId) ?? null : null;
    return {
      offerId:     o.id,
      intakeId:    o.intake_id,
      guestCallId: o.guest_call_id,
      matchScore:  Number(o.match_score),
      offeredAt:   o.offered_at,
      expiresAt:   o.expires_at,
      engineer: {
        userId:          o.engineer_user_id,
        displayName:     displayNameFor(o.engineer_user_id),
        email:           emailById.get(o.engineer_user_id) ?? "",
        experienceLevel: engProfile?.experience_level ?? null,
      },
      pod:         pod ? { id: pod.id, name: pod.name } : null,
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

  return NextResponse.json({ rows });
}
