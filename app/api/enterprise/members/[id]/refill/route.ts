/*
 * POST /api/enterprise/members/:id/refill
 *   Body: { amount: number }   amount > 0
 *   Refill a member DIRECTLY from the org wallet (organizations.remaining_minutes)
 *   via the atomic transfer_org_to_employee RPC — the enterprise admin's default
 *   per-member top-up source. Scoped to the caller's org. Reuses existing
 *   crediting (an RPC), not a re-implementation.
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
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  // Target must belong to the caller's org (the RPC re-checks, but a friendly
  // 404 here beats a raw exception).
  const { data: target } = await admin
    .from("profiles")
    .select("id, organization_id, status")
    .eq("id", id)
    .maybeSingle();
  const t = target as {
    organization_id: string | null;
    status: string | null;
  } | null;
  if (!t || t.organization_id !== orgId) {
    return NextResponse.json({ error: "not_in_org" }, { status: 404 });
  }
  // A suspended member has had their minutes returned to the pool — refilling
  // would resurrect a balance on a locked-out account. Reactivate first.
  if (t.status === "suspended") {
    return NextResponse.json(
      { error: "Reactivate this member's access before refilling minutes." },
      { status: 409 }
    );
  }

  const { error } = await admin.rpc("transfer_org_to_employee", {
    _org_id: orgId,
    _profile_id: id,
    _amount: amt,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: after } = await admin
    .from("profiles")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", id)
    .maybeSingle();
  const a = after as {
    allocated_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
  } | null;

  return NextResponse.json({
    ok: true,
    employee: {
      id,
      allocatedMinutes: Number(a?.allocated_minutes ?? 0),
      usedMinutes: Number(a?.used_minutes ?? 0),
      remainingMinutes: Number(a?.remaining_minutes ?? 0),
    },
  });
}
