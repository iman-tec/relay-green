/*
 * Reseller-scoped department edit.
 *
 * PATCH /api/reseller/orgs/:id/departments/:deptId
 *   Body: any subset of { name, status }
 *   Mirrors /api/enterprise/departments/:id PATCH but gated on the
 *   reseller role and an ownership check: the dept's enterprise must
 *   belong to the calling reseller (org.reseller_id === resellerId).
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; deptId: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;
  const { id: orgId, deptId } = await params;

  // Ownership: dept.enterprise_id must match orgId, AND that org must
  // belong to this reseller. Two-step lookup is fine — small data.
  const { data: dept } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", deptId)
    .maybeSingle();
  const d = dept as { id: string; enterprise_id: string } | null;
  if (!d || d.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in this org." }, { status: 404 });
  }
  const { data: org } = await admin
    .from("organizations")
    .select("id, reseller_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || (org as { reseller_id: string | null }).reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const { name, status } = (await request.json().catch(() => ({}))) as {
    name?:   string;
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
      return NextResponse.json({ error: "A department with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ department: data });
}
