/*
 * POST /api/admin/partner-applications/[id]/approve — approve → instant
 * provision.
 *
 * One action, end to end: claim the application (atomic new → approved via the
 * claim_partner_application RPC, which is the single-fire guard), provision the
 * live reseller through the shared provisionReseller path (default 20%
 * commission, generated reseller_code, /partner login invite), then link the
 * new reseller back onto the application.
 *
 * Idempotent: a second approve loses the claim race (RPC returns no row) and
 * returns the already-linked reseller instead of creating a second. If
 * provisioning fails after the claim, the status is reverted to 'new' so the
 * application can be retried — never left approved-without-a-reseller.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { provisionReseller } from "@/lib/reseller-provision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_COMMISSION = 20;

type AppRow = {
  id: string;
  contact_name: string;
  work_email: string;
  status: string;
  reseller_id: string | null;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;
  const { id } = await params;

  // Atomic claim: flips new → approved and stamps the reviewer, returning the
  // row ONLY if this call won. Empty result = already claimed (or missing).
  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_partner_application",
    { _id: id, _status: "approved", _reviewer: actor.id }
  );
  if (claimErr)
    return NextResponse.json({ error: claimErr.message }, { status: 500 });

  const claimedRow = (claimed as AppRow[] | null)?.[0] ?? null;

  if (!claimedRow) {
    // We didn't win the claim. Either already approved (idempotent success —
    // return the existing reseller) or missing / in another terminal state.
    const { data: current } = await admin
      .from("partner_applications")
      .select("id, status, reseller_id")
      .eq("id", id)
      .maybeSingle();
    const row = current as Pick<AppRow, "id" | "status" | "reseller_id"> | null;
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (row.status === "approved") {
      return NextResponse.json({
        ok: true,
        alreadyApproved: true,
        resellerId: row.reseller_id,
      });
    }
    return NextResponse.json(
      { error: `Application is '${row.status}', cannot approve.` },
      { status: 409 }
    );
  }

  // We own the claim. Provision the reseller (link, not error, if one already
  // exists for this email — keeps approve idempotent against manual creation).
  const result = await provisionReseller(admin, {
    name: claimedRow.contact_name,
    email: claimedRow.work_email,
    commission: DEFAULT_COMMISSION,
    actorId: actor.id,
    onExisting: "link",
  });

  if (!result.ok) {
    // Roll the status back so the application can be retried — never leave it
    // approved with no reseller.
    await admin
      .from("partner_applications")
      .update({ status: "new", reviewed_by: null, reviewed_at: null })
      .eq("id", id);
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  // Link the provisioned reseller back onto the application.
  await admin
    .from("partner_applications")
    .update({ reseller_id: result.reseller.id })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    reseller: result.reseller,
    mode: result.mode,
    invited: result.mode === "invited",
  });
}
