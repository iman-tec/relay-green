/*
 * POST /api/department/employees/:id/resend-invite
 *   Re-send the invite / sign-in link to one of the department's own employees.
 *   Reuses resendInvitationEmail (invite for unconfirmed users, OTP link for
 *   confirmed). Scoped: the target must belong to the caller's department.
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";
import { resendInvitationEmail } from "@/lib/admin-invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const { data: owned } = await admin
    .from("profiles")
    .select("id, department_id")
    .eq("id", id)
    .maybeSingle();
  if (
    !owned ||
    (owned as { department_id: string | null }).department_id !== departmentId
  ) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const res = await resendInvitationEmail(admin, id);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
