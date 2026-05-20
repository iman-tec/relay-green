/*
 * Reseller refill — add minutes from the implicit superadmin pool.
 *
 * POST /api/admin/resellers/:id/refill
 *   Body: { amount: number }   amount > 0
 *   Calls transfer_to_reseller(id, amount) atomically. Returns the
 *   updated balance. Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { id } = await params;
  const { amount } = (await request.json().catch(() => ({}))) as { amount?: number | string };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  const { error } = await admin.rpc("transfer_to_reseller", {
    _reseller_id: id,
    _amount:      amt,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: row } = await admin
    .from("resellers")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    reseller: row
      ? {
          id: (row as { id: string }).id,
          allocatedMinutes: Number((row as { allocated_minutes: number }).allocated_minutes),
          usedMinutes:      Number((row as { used_minutes: number }).used_minutes),
          remainingMinutes: Number((row as { remaining_minutes: number }).remaining_minutes),
        }
      : null,
  });
}
