/*
 * Enterprise-scoped department — edit / activate / deactivate.
 *
 * PATCH /api/enterprise/departments/:id
 *   Body: any subset of { name, status }
 *   Status semantics:
 *     - 'suspended' → calls deactivate_department RPC (cascades through
 *                     employees + returns dept remainder to enterprise)
 *     - 'active'    → direct flip back
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { banUsers, unbanUser } from "@/lib/auth-ban";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { id } = await params;

  // Ownership guard.
  const { data: owned } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", id)
    .maybeSingle();
  if (!owned || (owned as { enterprise_id: string }).enterprise_id !== orgId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    status?: string;
  };

  if (body.status) {
    if (body.status === "suspended") {
      // Collect every profile attached to this dept (employees + admin)
      // BEFORE the RPC fires; the cascade itself doesn't touch auth users.
      const { data: members } = await admin
        .from("profiles")
        .select("id")
        .eq("department_id", id);
      const memberIds = (members ?? []).map((m: { id: string }) => m.id);

      const { error } = await admin.rpc("deactivate_department", { _dept_id: id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      await banUsers(admin, memberIds);
      return NextResponse.json({ ok: true, status: "suspended" });
    }
    if (body.status === "active") {
      const { error } = await admin
        .from("departments")
        .update({ status: "active" })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      // Reactivating a dept only restores the dept-admin's login. Employees
      // remain suspended until the dept admin reactivates each one — the
      // spec doesn't cascade reactivation, only deactivation.
      const { data: deptRow } = await admin
        .from("departments")
        .select("admin_user_id")
        .eq("id", id)
        .maybeSingle();
      const adminId = (deptRow as { admin_user_id: string | null } | null)?.admin_user_id;
      if (adminId) await unbanUser(admin, adminId);
      return NextResponse.json({ ok: true, status: "active" });
    }
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name?.trim()) update.name = body.name.trim();
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const { error } = await admin.from("departments").update(update).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Another department already uses this name." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
