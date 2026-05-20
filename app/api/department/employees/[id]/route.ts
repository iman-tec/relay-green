/*
 * Department-scoped employee — edit / activate / deactivate.
 *
 * PATCH /api/department/employees/:id
 *   Body: any subset of { name, status }
 *
 * Per spec, the department admin cannot:
 *   - reset employee passwords    → no password field accepted
 *   - reassign employees          → no department_id field accepted
 *
 * Status semantics:
 *   - 'suspended' → calls deactivate_employee RPC; the employee's
 *                   remaining minutes flow back to the department pool.
 *   - 'active'    → direct flip back
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";
import { banUser, unbanUser } from "@/lib/auth-ban";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const { id } = await params;

  // Ownership: employee must belong to this department.
  const { data: owned } = await admin
    .from("profiles")
    .select("id, department_id")
    .eq("id", id)
    .maybeSingle();
  if (!owned || (owned as { department_id: string | null }).department_id !== departmentId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?:   string;
    status?: string;
    // Refuse silently-ignored fields rather than letting the caller think
    // they worked. Spec is explicit: dept admins can't do these.
    password?:      unknown;
    department_id?: unknown;
  };

  if (body.password !== undefined) {
    return NextResponse.json({ error: "Department admins can't reset employee passwords." }, { status: 403 });
  }
  if (body.department_id !== undefined) {
    return NextResponse.json({ error: "Department admins can't reassign employees." }, { status: 403 });
  }

  if (body.status) {
    if (body.status === "suspended") {
      const { error } = await admin.rpc("deactivate_employee", { _profile_id: id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      // Block sign-in too — the RPC only handles profile.status.
      await banUser(admin, id);
      return NextResponse.json({ ok: true, status: "suspended" });
    }
    if (body.status === "active") {
      const { error } = await admin
        .from("profiles")
        .update({ status: "active" })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await unbanUser(admin, id);
      return NextResponse.json({ ok: true, status: "active" });
    }
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name?.trim()) update.full_name = body.name.trim();
  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const { error } = await admin.from("profiles").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
