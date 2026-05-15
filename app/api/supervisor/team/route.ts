/*
 * Supervisor's team roster.
 *
 * GET /api/supervisor/team
 *   Lists every engineer in the caller's pod. For each engineer:
 *     - displayName, email, primaryRole
 *     - currentCustomer: name of the guest on their active call (or null)
 *     - lastCallAt + lastCustomer: most recent completed session
 *
 * Gated to pod_lead only. Super admins see other surfaces; the
 * supervisor's personal team roster doesn't apply to them.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const LIVE_STATES = ["live", "joining", "grace", "assigned"];

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  // Supervisor-only — super_admin is explicitly excluded, even if they
  // also hold pod_lead from testing.
  if (roles.includes("super_admin") || !roles.includes("pod_lead")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
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

  // 2. Engineers in that pod.
  const { data: members } = await admin
    .from("pod_members")
    .select("user_id")
    .eq("pod_id", podId)
    .eq("pod_role", "engineer");
  const engineerIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (engineerIds.length === 0) {
    return NextResponse.json({ pod, engineers: [] });
  }

  // 3. Profiles + emails (auth.users) in one shot.
  const [{ data: profiles }, { data: authList }] = await Promise.all([
    admin.from("profiles").select("id, full_name, primary_role").in("id", engineerIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const emailById = new Map<string, string>();
  for (const u of authList?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
  }

  // 4. Current live call + last completed call per engineer.
  //    We fetch in two queries scoped to the engineers we care about.
  const [{ data: liveCalls }, { data: pastCalls }] = await Promise.all([
    admin
      .from("guest_calls")
      .select("id, claimed_by, guest_name, created_at, status")
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

  type CallRow = { id: string; claimed_by: string | null; guest_name: string | null };
  const currentByEng = new Map<string, CallRow>();
  for (const c of (liveCalls ?? []) as (CallRow & { created_at: string })[]) {
    if (c.claimed_by && !currentByEng.has(c.claimed_by)) currentByEng.set(c.claimed_by, c);
  }

  const lastByEng = new Map<string, (CallRow & { ended_at: string })>();
  for (const c of (pastCalls ?? []) as (CallRow & { ended_at: string })[]) {
    if (c.claimed_by && !lastByEng.has(c.claimed_by)) lastByEng.set(c.claimed_by, c);
  }

  const engineers = (profiles ?? []).map((p: { id: string; full_name: string | null; primary_role: string | null }) => {
    const cur  = currentByEng.get(p.id);
    const last = lastByEng.get(p.id);
    return {
      userId:          p.id,
      displayName:     p.full_name ?? "Unnamed",
      email:           emailById.get(p.id) ?? "",
      primaryRole:     p.primary_role ?? "engineer",
      currentCustomer: cur?.guest_name ?? null,
      lastCustomer:    last?.guest_name ?? null,
      lastCallAt:      last?.ended_at ?? null,
    };
  });

  engineers.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return NextResponse.json({ pod, engineers });
}
