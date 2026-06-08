/*
 * POST /api/enterprise/members/:id/reassign
 *   Body: { departmentId: string }
 *   Move a member to a different department within the caller's org. Only the
 *   member's department_id label changes — their personal minute balance is on
 *   the profile and travels with them, and the dept pools are untouched (the
 *   minutes were already debited when first allocated), so this is money-safe.
 *
 *   Guards: target in caller's org; destination dept in caller's org; target is
 *   not a peer enterprise_admin.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { id } = await params;
  const { departmentId } = (await request.json().catch(() => ({}))) as {
    departmentId?: string;
  };
  if (!id || !departmentId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Destination dept must live under the caller's org.
  const { data: dept } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", departmentId)
    .maybeSingle();
  if (!dept || (dept as { enterprise_id: string }).enterprise_id !== orgId) {
    return NextResponse.json({ error: "dept_not_in_org" }, { status: 404 });
  }

  // Target member must live under the caller's org.
  const { data: target } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (
    !target ||
    (target as { organization_id: string | null }).organization_id !== orgId
  ) {
    return NextResponse.json({ error: "not_in_org" }, { status: 404 });
  }

  // Don't relocate a peer enterprise_admin via this surface.
  const { data: roles } = await admin
    .from("user_role_names")
    .select("role")
    .eq("user_id", id);
  if (
    (roles ?? []).some(
      (r: { role: string }) => r.role === ROLE.enterprise_admin
    )
  ) {
    return NextResponse.json(
      { error: "Enterprise admins aren't assigned to a department." },
      { status: 403 }
    );
  }

  const { error } = await admin
    .from("profiles")
    .update({ department_id: departmentId })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, departmentId });
}
