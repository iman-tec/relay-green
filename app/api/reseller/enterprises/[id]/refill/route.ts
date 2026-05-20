/*
 * Reseller refills an inorganic enterprise.
 *
 * POST /api/reseller/enterprises/:id/refill
 *   Body: { amount: number }  amount > 0, ≤ reseller.remaining_minutes
 *   Calls transfer_to_organization(orgId, amount) atomically; the RPC
 *   debits the reseller pool and credits the enterprise in one shot.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { id } = await params;
  const { amount } = (await request.json().catch(() => ({}))) as { amount?: number | string };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  // Ownership check.
  const { data: owned } = await admin
    .from("organizations")
    .select("id, reseller_id, enterprise_type")
    .eq("id", id)
    .maybeSingle();
  const o = owned as { reseller_id: string | null; enterprise_type: string } | null;
  if (!o || o.reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_owned" }, { status: 404 });
  }

  // The RPC validates the reseller's balance and updates both sides atomically.
  const { error } = await admin.rpc("transfer_to_organization", {
    _org_id: id,
    _amount: amt,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: orgAfter } = await admin
    .from("organizations")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", id)
    .maybeSingle();
  const { data: resellerAfter } = await admin
    .from("resellers")
    .select("remaining_minutes")
    .eq("id", resellerId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    enterprise: orgAfter
      ? {
          id: (orgAfter as { id: string }).id,
          allocatedMinutes: Number((orgAfter as { allocated_minutes: number }).allocated_minutes),
          usedMinutes:      Number((orgAfter as { used_minutes: number }).used_minutes),
          remainingMinutes: Number((orgAfter as { remaining_minutes: number }).remaining_minutes),
        }
      : null,
    resellerRemaining: resellerAfter
      ? Number((resellerAfter as { remaining_minutes: number }).remaining_minutes)
      : null,
  });
}
