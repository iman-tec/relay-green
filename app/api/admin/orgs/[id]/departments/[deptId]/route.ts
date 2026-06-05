/*
 * Admin-side department edit + delete.
 *
 * PATCH  /api/admin/orgs/:id/departments/:deptId   Update name and/or status.
 * DELETE /api/admin/orgs/:id/departments/:deptId   Detach employees, drop dept_admin grants, delete row.
 *
 * Caller must hold super_admin. The :id (org) must match the department's
 * enterprise_id — defends against cross-org writes via guessed URLs.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; deptId: string }> };

async function loadDept(admin: SupabaseClient, orgId: string, deptId: string) {
  const { data } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", deptId)
    .maybeSingle();
  const row = data as { id: string; enterprise_id: string } | null;
  if (!row || row.enterprise_id !== orgId) return null;
  return row;
}

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;
  const { id: orgId, deptId } = await params;

  const dept = await loadDept(admin, orgId, deptId);
  if (!dept)
    return NextResponse.json(
      { error: "Department not found in this org." },
      { status: 404 }
    );

  const { name, status } = (await request.json().catch(() => ({}))) as {
    name?: string;
    status?: string;
  };
  const patch: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (status === "active" || status === "suspended") patch.status = status;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("departments")
    .update(patch)
    .eq("id", deptId)
    .select("id, name, status, department_code")
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "A department with this name already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ department: data });
}

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;
  const { id: orgId, deptId } = await params;

  const dept = await loadDept(admin, orgId, deptId);
  if (!dept)
    return NextResponse.json(
      { error: "Department not found in this org." },
      { status: 404 }
    );

  // Drain the department's minutes (member remainders → dept pool →
  // enterprise pool) BEFORE the row is deleted, or the whole pool would
  // vanish with it (see 20260604120000_current_grant_ledger.sql).
  //
  // PGRST202 = the RPC isn't deployed yet (migration not applied). Fall
  // back to the legacy delete-without-refund rather than blocking.
  const { error: relErr } = await admin.rpc("release_department_minutes", { _dept_id: deptId });
  if (relErr) {
    const missing = (relErr as { code?: string }).code === "PGRST202"
      || relErr.message.includes("Could not find the function");
    if (!missing) return NextResponse.json({ error: relErr.message }, { status: 400 });
    console.warn("[admin/dept-delete] release_department_minutes missing — apply 20260604120000_current_grant_ledger.sql");
  }

  // Drain the department's minutes (member remainders → dept pool →
  // enterprise pool) BEFORE the row is deleted, or the whole pool would
  // vanish with it (see 20260604120000_current_grant_ledger.sql).
  //
  // PGRST202 = the RPC isn't deployed yet (migration not applied). Fall
  // back to the legacy delete-without-refund rather than blocking.
  const { error: relErr } = await admin.rpc("release_department_minutes", { _dept_id: deptId });
  if (relErr) {
    const missing = (relErr as { code?: string }).code === "PGRST202"
      || relErr.message.includes("Could not find the function");
    if (!missing) return NextResponse.json({ error: relErr.message }, { status: 400 });
    console.warn("[admin/dept-delete] release_department_minutes missing — apply 20260604120000_current_grant_ledger.sql");
  }

  const { data: memberRows } = await admin
    .from("profiles")
    .select("id")
    .eq("department_id", deptId);
  const memberIds = ((memberRows ?? []) as { id: string }[]).map((m) => m.id);
  if (memberIds.length) {
    await admin
      .from("profiles")
      .update({ department_id: null, client_type: "client" })
      .in("id", memberIds);
    const { data: roleRow } = await admin
      .from("roles")
      .select("id")
      .eq("name", ROLE.department_admin)
      .maybeSingle();
    const roleId = (roleRow as { id: string } | null)?.id;
    if (roleId) {
      await admin
        .from("user_roles")
        .delete()
        .in("user_id", memberIds)
        .eq("role_id", roleId);
    }
  }

  const { error } = await admin.from("departments").delete().eq("id", deptId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
