/*
 * Eligible-users picker for pod assignment.
 *
 * GET /api/admin/pods/eligible-users?role=engineer
 *   Returns users who:
 *     • hold the given role in user_roles (engineer or supervisor), AND
 *     • are NOT already in any pod.
 *
 * The pod_role query param is the front-end's "pod role" enum
 * ('supervisor' | 'engineer'), which now maps 1:1 onto the same user_role
 * names — the historic split between pod_lead and supervisor is gone.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POD_ROLE_TO_USER_ROLE: Record<string, string> = {
  supervisor: ROLE.supervisor,
  engineer: ROLE.engineer,
};

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const url = new URL(request.url);
  const podRole = url.searchParams.get("role") ?? "";
  const userRole = POD_ROLE_TO_USER_ROLE[podRole];
  if (!userRole) {
    return NextResponse.json(
      { error: "role param must be 'supervisor' or 'engineer'." },
      { status: 400 }
    );
  }

  // 1. Users holding the target role
  const { data: roleRows, error: roleErr } = await admin
    .from("user_role_names")
    .select("user_id")
    .eq("role", userRole);
  if (roleErr)
    return NextResponse.json({ error: roleErr.message }, { status: 500 });

  const candidateIds = [...new Set((roleRows ?? []).map((r) => r.user_id))];
  if (candidateIds.length === 0) return NextResponse.json({ users: [] });

  // 2. Of those, exclude any already in a pod
  const { data: assignedRows } = await admin
    .from("pod_members")
    .select("user_id")
    .in("user_id", candidateIds);
  const assignedSet = new Set((assignedRows ?? []).map((r) => r.user_id));

  const availableIds = candidateIds.filter((id) => !assignedSet.has(id));
  if (availableIds.length === 0) return NextResponse.json({ users: [] });

  // 3. Resolve display name + email
  const [{ data: profiles }, { data: authPage }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", availableIds),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const profileMap = new Map<string, string>();
  for (const p of (profiles ?? []) as {
    id: string;
    full_name: string | null;
  }[]) {
    if (p.full_name) profileMap.set(p.id, p.full_name);
  }
  const authMap = new Map<string, { email: string }>();
  for (const u of authPage?.users ?? []) {
    if (availableIds.includes(u.id))
      authMap.set(u.id, { email: u.email ?? "" });
  }

  return NextResponse.json({
    users: availableIds.map((id) => ({
      id,
      email: authMap.get(id)?.email ?? "",
      displayName: profileMap.get(id) ?? "",
    })),
  });
}
