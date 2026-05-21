/*
 * Per-member admin actions for a department.
 *
 * DELETE /api/admin/orgs/:id/departments/:deptId/employees/:empId
 *   Detach a user (employee OR department admin) from this department.
 *   - Always clears department_id and resets client_type='client' on the profile.
 *   - If they were the dept's admin (departments.admin_user_id === empId),
 *     also clears that pointer + drops the department_admin role grant so
 *     they're not a dangling dept_admin without a dept.
 *
 * Doesn't delete the auth user — they keep their account and can be
 * re-assigned elsewhere later.
 *
 * The :id / :deptId chain is verified end-to-end to defend against guessed URLs.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; deptId: string; empId: string }> };

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;
  const { id: orgId, deptId, empId } = await params;

  // Verify the dept lives under this org so a guessed URL can't sidestep scope.
  const { data: deptRow } = await admin
    .from("departments")
    .select("id, enterprise_id, admin_user_id")
    .eq("id", deptId)
    .maybeSingle();
  const d = deptRow as { id: string; enterprise_id: string; admin_user_id: string | null } | null;
  if (!d || d.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in this org." }, { status: 404 });
  }

  const isDeptAdmin = d.admin_user_id === empId;

  // For employees we expect department_id to match; for the dept admin
  // it should too (set when the dept was created). We accept either as
  // long as the user is genuinely attached to this dept.
  const { data: prof } = await admin
    .from("profiles")
    .select("id, organization_id, department_id, client_type")
    .eq("id", empId)
    .maybeSingle();
  const p = prof as {
    id: string;
    organization_id: string | null;
    department_id: string | null;
    client_type: string | null;
  } | null;
  if (!p || (p.department_id !== deptId && !isDeptAdmin)) {
    return NextResponse.json({ error: "User not found in this department." }, { status: 404 });
  }
  if (p && p.organization_id && p.organization_id !== orgId) {
    return NextResponse.json({ error: "User belongs to a different organization." }, { status: 409 });
  }

  const { error: profErr } = await admin
    .from("profiles")
    .update({ department_id: null, client_type: "client" })
    .eq("id", empId);
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

  if (isDeptAdmin) {
    await admin
      .from("departments")
      .update({ admin_user_id: null })
      .eq("id", deptId);
    // Drop the department_admin role grant — meaningless without a dept.
    const { data: roleRow } = await admin
      .from("roles").select("id").eq("name", ROLE.department_admin).maybeSingle();
    const roleId = (roleRow as { id: string } | null)?.id;
    if (roleId) {
      await admin.from("user_roles").delete().eq("user_id", empId).eq("role_id", roleId);
    }
  }

  return NextResponse.json({ ok: true, wasAdmin: isDeptAdmin });
}
