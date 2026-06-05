/*
 * Enterprise refills a department.
 *
 * POST /api/enterprise/departments/:id/refill
 *   Body: { amount: number }   amount > 0, ≤ enterprise.remaining_minutes
 *   Calls transfer_to_department(deptId, amount) atomically.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { id } = await params;
  const { amount } = (await request.json().catch(() => ({}))) as {
    amount?: number | string;
  };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  const { data: owned } = await admin
    .from("departments")
    .select("id, enterprise_id")
    .eq("id", id)
    .maybeSingle();
  if (!owned || (owned as { enterprise_id: string }).enterprise_id !== orgId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  const { error } = await admin.rpc("transfer_to_department", {
    _dept_id: id,
    _amount: amt,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: deptAfter } = await admin
    .from("departments")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", id)
    .maybeSingle();
  const { data: orgAfter } = await admin
    .from("organizations")
    .select("remaining_minutes")
    .eq("id", orgId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    department: deptAfter
      ? {
          id: (deptAfter as { id: string }).id,
          allocatedMinutes: Number(
            (deptAfter as { allocated_minutes: number }).allocated_minutes
          ),
          usedMinutes: Number(
            (deptAfter as { used_minutes: number }).used_minutes
          ),
          remainingMinutes: Number(
            (deptAfter as { remaining_minutes: number }).remaining_minutes
          ),
        }
      : null,
    enterpriseRemaining: orgAfter
      ? Number((orgAfter as { remaining_minutes: number }).remaining_minutes)
      : null,
  });
}
