/*
 * Organization refill — super admin adds minutes to an enterprise's pool.
 *
 * POST /api/admin/orgs/:id/refill
 *   Body: { amount: number }   amount > 0
 *   Calls transfer_to_organization(id, amount) atomically:
 *     - organic enterprise   → mints from the implicit superadmin pool.
 *     - inorganic enterprise → debits the owning reseller's pool (and
 *       fails if that pool is short — surfaced as a friendly message so
 *       the admin knows to top up the Channel Partner first).
 *   Caller must hold super_admin.
 *
 * Companion to /api/admin/resellers/:id/refill. Fills the gap where an
 * enterprise created with 0 minutes had no top-up path from the admin UI.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { id } = await params;
  const { amount } = (await request.json().catch(() => ({}))) as {
    amount?: number | string;
  };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!org)
    return NextResponse.json(
      { error: "Organization not found." },
      { status: 404 }
    );

  const { error } = await admin.rpc("transfer_to_organization", {
    _org_id: id,
    _amount: amt,
  });
  if (error) {
    // transfer_to_organization raises "reseller has insufficient
    // remaining_minutes" for inorganic orgs whose partner pool is short.
    if (/insufficient/i.test(error.message ?? "")) {
      return NextResponse.json(
        {
          error:
            "The Channel Partner's pool is short — top up the partner first.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: after } = await admin
    .from("organizations")
    .select("id, allocated_minutes, used_minutes, remaining_minutes")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    organization: after
      ? {
          id: (after as { id: string }).id,
          allocatedMinutes: Number(
            (after as { allocated_minutes: number }).allocated_minutes
          ),
          usedMinutes: Number((after as { used_minutes: number }).used_minutes),
          remainingMinutes: Number(
            (after as { remaining_minutes: number }).remaining_minutes
          ),
        }
      : null,
  });
}
