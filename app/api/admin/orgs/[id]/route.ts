/*
 * Organization API — edit + delete one.
 *
 * PATCH  /api/admin/orgs/:id   Update name and/or status (active/suspended).
 * DELETE /api/admin/orgs/:id   Remove org; detach profiles + drop enterprise_admin grants.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;
  const { id } = await params;

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
    .from("organizations")
    .update(patch)
    .eq("id", id)
    .select("id, name, status")
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data)
    return NextResponse.json({ error: "Org not found." }, { status: 404 });

  return NextResponse.json({ org: data });
}

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;

  const { id } = await params;

  // Detach profiles from the org so we don't leave dangling FKs.
  const { data: memberRows, error: memberErr } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", id);
  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  const memberIds = (memberRows ?? []).map((p: { id: string }) => p.id);

  if (memberIds.length) {
    // Clear BOTH organization_id and department_id in the same update.
    // profiles has a CHECK (profiles_dept_requires_org): a row with a
    // department_id must also have an organization_id. Nulling org while a
    // member still belongs to one of this org's departments would violate it
    // ("new row for relation profiles violates check constraint
    // profiles_dept_requires_org"). Clearing both together keeps the row valid
    // (department_id IS NULL satisfies the check). The org's departments get
    // cascade-deleted with the org below anyway.
    const { error: detachErr } = await admin
      .from("profiles")
      .update({ organization_id: null, department_id: null })
      .in("id", memberIds);
    if (detachErr) {
      return NextResponse.json({ error: detachErr.message }, { status: 500 });
    }
    // Drop the enterprise_admin role from the org's admins — without an
    // org, that role doesn't mean anything.
    const { data: roleRow } = await admin
      .from("roles")
      .select("id")
      .eq("name", ROLE.enterprise_admin)
      .maybeSingle();
    const enterpriseAdminRoleId = (roleRow as { id: string } | null)?.id;
    if (enterpriseAdminRoleId) {
      await admin
        .from("user_roles")
        .delete()
        .in("user_id", memberIds)
        .eq("role_id", enterpriseAdminRoleId);
    }
  }

  const { error: orgErr } = await admin
    .from("organizations")
    .delete()
    .eq("id", id);
  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
