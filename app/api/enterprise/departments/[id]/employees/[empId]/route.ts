/*
 * DELETE /api/enterprise/departments/:id/employees/:empId
 *   Detach a user (employee or dept admin) from this department.
 *   - Always clears profile.department_id and resets client_type='client'.
 *   - If they were the dept's admin, also clears that pointer + drops
 *     the department_admin role grant.
 *   Does NOT delete the auth account.
 *
 * Caller must hold enterprise_admin and the dept must live under their org.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; empId: string }> };

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;
  const { id: deptId, empId } = await params;

  const { data: deptRow } = await admin
    .from("departments").select("id, enterprise_id, admin_user_id").eq("id", deptId).maybeSingle();
  const d = deptRow as { id: string; enterprise_id: string; admin_user_id: string | null } | null;
  if (!d || d.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in your org." }, { status: 404 });
  }
  const isDeptAdmin = d.admin_user_id === empId;

  const { data: prof } = await admin
    .from("profiles").select("id, organization_id, department_id, client_type").eq("id", empId).maybeSingle();
  const p = prof as {
    id: string; organization_id: string | null;
    department_id: string | null; client_type: string | null;
  } | null;
  if (!p || (p.department_id !== deptId && !isDeptAdmin)) {
    return NextResponse.json({ error: "User not found in this department." }, { status: 404 });
  }
  if (p && p.organization_id && p.organization_id !== orgId) {
    return NextResponse.json({ error: "User belongs to a different organization." }, { status: 409 });
  }

  // Return the user's unused minutes to the dept pool BEFORE detaching —
  // once department_id is cleared the pool can't be resolved and the
  // remainder would be stranded on a plain-client profile (see
  // 20260604120000_current_grant_ledger.sql).
  //
  // PGRST202 = the RPC isn't deployed yet (migration not applied). Fall
  // back to the legacy detach-without-refund rather than blocking the
  // action; the migration's backfill repairs the stranded remainder later.
  const { error: relErr } = await admin.rpc("release_employee_minutes", { _profile_id: empId });
  if (relErr) {
    const missing = (relErr as { code?: string }).code === "PGRST202"
      || relErr.message.includes("Could not find the function");
    if (!missing) return NextResponse.json({ error: relErr.message }, { status: 400 });
    console.warn("[enterprise/detach] release_employee_minutes missing — apply 20260604120000_current_grant_ledger.sql");
  }

  const { error: profErr } = await admin
    .from("profiles").update({ department_id: null, client_type: "client" }).eq("id", empId);
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });

  if (isDeptAdmin) {
    await admin.from("departments").update({ admin_user_id: null }).eq("id", deptId);
    const { data: roleRow } = await admin
      .from("roles").select("id").eq("name", ROLE.department_admin).maybeSingle();
    const roleId = (roleRow as { id: string } | null)?.id;
    if (roleId) {
      await admin.from("user_roles").delete().eq("user_id", empId).eq("role_id", roleId);
    }
  }

  return NextResponse.json({ ok: true, wasAdmin: isDeptAdmin });
}
