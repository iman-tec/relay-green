/*
 * Super-admin assignments API.
 *
 * GET  /api/admin/assignments
 *   Returns:
 *     - supervisors: [{ userId, displayName, email, podId, podName }]
 *     - engineers:   [{ userId, displayName, email, podId, podName }]
 *
 * PUT  /api/admin/assignments
 *   Body: { engineerId, podId: string | null }
 *   Upserts pod_members for the engineer. podId=null removes them from
 *   their current pod. pod_members has UNIQUE(user_id), so each engineer
 *   belongs to at most one pod.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

async function gate() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "not_signed_in" };

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("super_admin")) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false as const, status: 500, error: "service_role_not_configured" };
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { ok: true as const, user, admin };
}

export async function GET() {
  const g = await gate();
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { admin } = g;

  // Pods (active only) + their memberships.
  const { data: pods } = await admin
    .from("pods")
    .select("id, name")
    .is("archived_at", null)
    .order("name", { ascending: true });
  const podIds = (pods ?? []).map((p: { id: string }) => p.id);

  const { data: members } = podIds.length === 0
    ? { data: [] as { pod_id: string; user_id: string; pod_role: string }[] }
    : await admin
        .from("pod_members")
        .select("pod_id, user_id, pod_role")
        .in("pod_id", podIds);

  const podNameById = new Map<string, string>();
  for (const p of (pods ?? []) as { id: string; name: string }[]) podNameById.set(p.id, p.name);

  type PodMember = { pod_id: string; user_id: string; pod_role: string };
  const supervisorIds = new Set<string>();
  const engineerIds   = new Set<string>();
  const podByUser     = new Map<string, string>();
  for (const m of (members ?? []) as PodMember[]) {
    if (m.pod_role === "supervisor") supervisorIds.add(m.user_id);
    if (m.pod_role === "engineer")   engineerIds.add(m.user_id);
    podByUser.set(m.user_id, m.pod_id);
  }

  // Also include engineers who hold the engineer role but aren't yet in a
  // pod — those are the ones we'd want to assign.
  const { data: engineerRoleRows } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "engineer");
  for (const r of (engineerRoleRows ?? []) as { user_id: string }[]) {
    engineerIds.add(r.user_id);
  }

  const allUserIds = Array.from(new Set([...supervisorIds, ...engineerIds]));
  if (allUserIds.length === 0) {
    return NextResponse.json({ supervisors: [], engineers: [], pods: pods ?? [] });
  }

  const [{ data: profiles }, authList] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", allUserIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const profileById = new Map<string, { full_name: string | null }>();
  for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
    profileById.set(p.id, p);
  }
  const emailById = new Map<string, string>();
  const users = (authList.data as { users?: { id: string; email?: string }[] } | null)?.users ?? [];
  for (const u of users) {
    if (u.id && u.email) emailById.set(u.id, u.email);
  }

  const buildRow = (userId: string) => {
    const podId = podByUser.get(userId) ?? null;
    return {
      userId,
      displayName: profileById.get(userId)?.full_name ?? "Unnamed",
      email:       emailById.get(userId) ?? "",
      podId,
      podName:     podId ? podNameById.get(podId) ?? null : null,
    };
  };

  const supervisors = Array.from(supervisorIds).map(buildRow)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const engineers   = Array.from(engineerIds).map(buildRow)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({ supervisors, engineers, pods: pods ?? [] });
}

export async function PUT(request: Request) {
  const g = await gate();
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { admin } = g;

  const body = await request.json().catch(() => null) as
    | { engineerId?: string; podId?: string | null }
    | null;
  if (!body?.engineerId) {
    return NextResponse.json({ error: "engineerId required" }, { status: 400 });
  }

  // Confirm the target user is actually an engineer (defensive — keeps us
  // from putting a supervisor into another pod as an engineer).
  const { data: roleRows } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", body.engineerId);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes("engineer")) {
    return NextResponse.json({ error: "target is not an engineer" }, { status: 400 });
  }

  if (body.podId == null) {
    const { error } = await admin
      .from("pod_members")
      .delete()
      .eq("user_id", body.engineerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, podId: null });
  }

  // Upsert keyed on user_id (UNIQUE constraint on pod_members), so moving
  // an engineer to a new pod just rewrites the row.
  const { error } = await admin
    .from("pod_members")
    .upsert(
      { pod_id: body.podId, user_id: body.engineerId, pod_role: "engineer" },
      { onConflict: "user_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, podId: body.podId });
}
