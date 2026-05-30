/*
 * Department-admin self-service.
 *
 * PATCH /api/department   { name }
 *   Rename the caller's OWN department (resolved from their profile via
 *   requireDepartmentAdmin — no id is trusted from the client). Allocation,
 *   status, and structure stay with the enterprise admin.
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function PATCH(request: Request) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Department name is required." }, { status: 400 });

  const { error } = await admin
    .from("departments")
    .update({ name })
    .eq("id", departmentId);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Another department already uses this name." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, name });
}
