/*
 * Enterprise admin refills one of a department's employees.
 *
 * POST /api/enterprise/departments/:id/employees/:empId/refill
 *   Body: { amount: number }   amount > 0, ≤ department.remaining_minutes
 *   Calls transfer_to_employee(profileId, amount) atomically — the minutes
 *   come out of the employee's DEPARTMENT pool (same source the department
 *   admin's own refill uses). Top the department up first if its pool is dry.
 *
 * Mirrors /api/department/employees/:id/refill but gated on
 * requireEnterpriseAdmin + dept-in-org + employee-in-dept ownership.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string; empId: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;
  const { id: deptId, empId } = await params;

  const { amount } = (await request.json().catch(() => ({}))) as { amount?: number | string };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  // Dept must live under the caller's org.
  const { data: deptRow } = await admin
    .from("departments")
    .select("id, enterprise_id, status")
    .eq("id", deptId)
    .maybeSingle();
  const d = deptRow as { id: string; enterprise_id: string; status: string } | null;
  if (!d || d.enterprise_id !== orgId) {
    return NextResponse.json({ error: "Department not found in your org." }, { status: 404 });
  }
  if (d.status !== "active") {
    return NextResponse.json({ error: "Reactivate the department first." }, { status: 403 });
  }

  // Employee must belong to that department.
  const { data: prof } = await admin
    .from("profiles")
    .select("id, department_id")
    .eq("id", empId)
    .maybeSingle();
  if (!prof || (prof as { department_id: string | null }).department_id !== deptId) {
    return NextResponse.json({ error: "User not found in this department." }, { status: 404 });
  }

  const { error } = await admin.rpc("transfer_to_employee", {
    _profile_id: empId,
    _amount:     amt,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: empAfter } = await admin
    .from("profiles")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", empId)
    .maybeSingle();
  const { data: deptAfter } = await admin
    .from("departments")
    .select("remaining_minutes")
    .eq("id", deptId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    employee: empAfter
      ? {
          id:               (empAfter as { id: string }).id,
          allocatedMinutes: Number((empAfter as { allocated_minutes: number }).allocated_minutes),
          usedMinutes:      Number((empAfter as { used_minutes: number }).used_minutes),
          remainingMinutes: Number((empAfter as { remaining_minutes: number }).remaining_minutes),
        }
      : null,
    departmentRemaining: deptAfter
      ? Number((deptAfter as { remaining_minutes: number }).remaining_minutes)
      : null,
  });
}
