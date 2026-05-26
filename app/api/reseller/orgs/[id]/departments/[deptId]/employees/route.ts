/*
 * GET /api/reseller/orgs/:id/departments/:deptId  (aggregate-only)
 *
 * GDPR: a Channel Partner is a third party with NO lawful basis to see
 * end-user PII. This endpoint returns ONLY department-level aggregates +
 * a member COUNT — never member names, emails, last-sign-in, or individual
 * usage. (It previously leaked all of those; see docs/gdpr-data-access-matrix.md.)
 *
 *   Ownership check: org must belong to the calling reseller AND department
 *   must belong to that org.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { suppressValue, SUPPRESSED_LABEL } from "@/lib/relay/kanonymity";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; deptId: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;
  const { id: orgId, deptId } = await params;

  // Defence-in-depth: confirm the org belongs to this reseller.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, reseller_id")
    .eq("id", orgId)
    .maybeSingle();
  const org = orgRow as { id: string; reseller_id: string | null } | null;
  if (!org || org.reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const { data: deptRow } = await admin
    .from("departments")
    .select("id, enterprise_id, name, department_code, allocated_minutes, used_minutes, remaining_minutes, status")
    .eq("id", deptId)
    .maybeSingle();
  const dept = deptRow as {
    id: string; enterprise_id: string; name: string; department_code: string;
    allocated_minutes: number; used_minutes: number; remaining_minutes: number; status: string;
  } | null;
  if (!dept || dept.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in this org." }, { status: 404 });
  }

  // Member COUNT only — no profile rows, no auth lookup, no PII.
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("department_id", deptId);
  const memberCount = count ?? 0;

  // Per-department usage is member-derived → k-anon suppress below threshold.
  const usage = suppressValue(
    {
      allocatedMinutes: Number(dept.allocated_minutes ?? 0),
      usedMinutes:      Number(dept.used_minutes ?? 0),
      remainingMinutes: Number(dept.remaining_minutes ?? 0),
    },
    memberCount,
    "partnerEnterprise",
  );

  return NextResponse.json({
    department: {
      id:             dept.id,
      name:           dept.name,
      departmentCode: dept.department_code,
      status:         dept.status,
    },
    memberCount,
    usageSuppressed: usage.suppressed,
    usage:           usage.value,
    suppressedLabel: usage.suppressed ? SUPPRESSED_LABEL : null,
    // NO member roster, NO names, NO emails — GDPR data minimization.
  });
}
