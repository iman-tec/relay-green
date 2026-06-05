/*
 * Department refills one of its employees.
 *
 * POST /api/department/employees/:id/refill
 *   Body: { amount: number }   amount > 0, ≤ department.remaining_minutes
 *   Calls transfer_to_employee(profileId, amount) atomically.
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const { id } = await params;
  const { amount } = (await request.json().catch(() => ({}))) as {
    amount?: number | string;
  };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

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

  const { error } = await admin.rpc("transfer_to_employee", {
    _profile_id: id,
    _amount: amt,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: empAfter } = await admin
    .from("profiles")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", id)
    .maybeSingle();
  const { data: deptAfter } = await admin
    .from("departments")
    .select("remaining_minutes")
    .eq("id", departmentId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    employee: empAfter
      ? {
          id: (empAfter as { id: string }).id,
          allocatedMinutes: Number(
            (empAfter as { allocated_minutes: number }).allocated_minutes
          ),
          usedMinutes: Number(
            (empAfter as { used_minutes: number }).used_minutes
          ),
          remainingMinutes: Number(
            (empAfter as { remaining_minutes: number }).remaining_minutes
          ),
        }
      : null,
    departmentRemaining: deptAfter
      ? Number((deptAfter as { remaining_minutes: number }).remaining_minutes)
      : null,
  });
}
