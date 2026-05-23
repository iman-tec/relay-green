/*
 * GET /api/staff/assignable-engineers
 *
 * Powers the "Assign manually" dropdown on the matching boards
 * (master-prompt §4.3). Scope follows the caller's role:
 *   • super_admin / admin / ops_manager → every engineer, platform-wide
 *   • supervisor / pod_lead             → engineers in the pods they run
 *
 * Each engineer is annotated with `available` (their is_available toggle)
 * and `busy` (currently on a live call), so the UI can grey out engineers
 * who can't take the call. The actual assignment is done client-side via
 * the supervisor_assign_engineer RPC, which re-checks authority server-side.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export type AssignableEngineer = {
  userId:      string;
  displayName: string;
  email:       string;
  available:   boolean;
  busy:        boolean;
  podName:     string | null;
};

const ACTIVE_CALL_STATUSES = [
  "assigned", "joining", "live", "grace", "expired_free", "ending",
];

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const isAdmin =
    roles.includes(ROLE.super_admin) ||
    roles.includes("admin") ||
    roles.includes("ops_manager");
  const isSupervisor =
    roles.includes(ROLE.supervisor) || roles.includes("pod_lead");
  if (!isAdmin && !isSupervisor) {
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

  // ── Resolve the candidate engineer set ────────────────────────────────────
  let engineerIds: string[] = [];
  if (isAdmin) {
    const { data } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "engineer");
    engineerIds = Array.from(new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id)));
  } else {
    // Pods the caller supervises → engineers in those pods.
    const { data: myPods } = await admin
      .from("pod_members")
      .select("pod_id")
      .eq("user_id", user.id)
      .in("pod_role", ["supervisor", "pod_lead"]);
    const podIds = Array.from(new Set(((myPods ?? []) as { pod_id: string }[]).map((r) => r.pod_id)));
    if (podIds.length) {
      const { data: members } = await admin
        .from("pod_members")
        .select("user_id")
        .eq("pod_role", "engineer")
        .in("pod_id", podIds);
      engineerIds = Array.from(new Set(((members ?? []) as { user_id: string }[]).map((r) => r.user_id)));
    }
  }

  if (engineerIds.length === 0) {
    return NextResponse.json({ engineers: [] });
  }

  // ── Enrich: name, email, availability, busy state, pod name ───────────────
  const [profilesRes, availRes, busyRes, podMemRes, authListRes] = await Promise.all([
    admin.from("profiles_with_role").select("id, full_name").in("id", engineerIds),
    admin.from("engineer_profiles").select("user_id, is_available").in("user_id", engineerIds),
    admin.from("guest_calls").select("claimed_by").in("claimed_by", engineerIds).in("status", ACTIVE_CALL_STATUSES),
    admin.from("pod_members").select("user_id, pod_id").eq("pod_role", "engineer").in("user_id", engineerIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const nameById  = new Map<string, string>();
  const emailById = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) nameById.set(p.id, p.full_name);
  }
  for (const u of authListRes?.data?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
    if (u.id && !nameById.has(u.id) && u.email) nameById.set(u.id, u.email.split("@")[0]);
  }

  const availableById = new Map<string, boolean>();
  for (const r of (availRes.data ?? []) as { user_id: string; is_available: boolean }[]) {
    availableById.set(r.user_id, r.is_available);
  }
  const busySet = new Set<string>(
    ((busyRes.data ?? []) as { claimed_by: string | null }[])
      .map((r) => r.claimed_by)
      .filter((id): id is string => !!id),
  );

  const podIdByEngineer = new Map<string, string>();
  for (const m of (podMemRes.data ?? []) as { user_id: string; pod_id: string }[]) {
    if (!podIdByEngineer.has(m.user_id)) podIdByEngineer.set(m.user_id, m.pod_id);
  }
  const podIds = Array.from(new Set([...podIdByEngineer.values()]));
  const podNameById = new Map<string, string>();
  if (podIds.length) {
    const { data: pods } = await admin.from("pods").select("id, name").in("id", podIds);
    for (const p of (pods ?? []) as { id: string; name: string }[]) podNameById.set(p.id, p.name);
  }

  const engineers: AssignableEngineer[] = engineerIds.map((id) => {
    const podId = podIdByEngineer.get(id) ?? null;
    return {
      userId:      id,
      displayName: nameById.get(id) ?? "Unknown",
      email:       emailById.get(id) ?? "",
      available:   availableById.get(id) ?? true,
      busy:        busySet.has(id),
      podName:     podId ? podNameById.get(podId) ?? null : null,
    };
  });

  // Free + available first, then available, then the rest; alphabetical within.
  engineers.sort((a, b) => {
    const rank = (e: AssignableEngineer) => (e.busy ? 2 : e.available ? 0 : 1);
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    return a.displayName.localeCompare(b.displayName);
  });

  return NextResponse.json({ engineers });
}
