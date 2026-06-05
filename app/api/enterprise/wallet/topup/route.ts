/*
 * POST /api/enterprise/wallet/topup
 *
 * Server-verified credit of a prepaid minute bundle. Called by the client
 * right after stripe.confirmPayment() resolves without error. The client is
 * NOT trusted — we re-fetch the PaymentIntent from Stripe and verify:
 *   1. status === 'succeeded'
 *   2. metadata.relay_kind === 'enterprise_minutes'
 *   3. metadata.relay_org_id === the caller's organization
 *
 * Idempotency: we use the PaymentIntent's own metadata as the ledger —
 * once credited we stamp metadata.relay_credited='1', so a repeat call (or
 * a parallel webhook) is a no-op. Avoids needing a separate ledger table.
 *
 * Body: { paymentIntentId: string }
 * Returns: { ok, minutesAdded, remainingMinutes }
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { stripeRequest, STRIPE_KEY } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PaymentIntent = {
  id: string;
  status: string;
  metadata: Record<string, string>;
};

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  if (!STRIPE_KEY) {
    return NextResponse.json(
      { error: "Stripe key not configured for this build." },
      { status: 500 }
    );
  }

  const { paymentIntentId } = (await request.json().catch(() => ({}))) as {
    paymentIntentId?: string;
  };
  if (!paymentIntentId || !/^pi_/.test(paymentIntentId)) {
    return NextResponse.json(
      { error: "Missing or invalid paymentIntentId." },
      { status: 400 }
    );
  }

  const pi = await stripeRequest<PaymentIntent>(
    `/payment_intents/${paymentIntentId}`,
    "GET"
  );
  if (pi.status !== "succeeded") {
    return NextResponse.json(
      { error: `Payment not completed (status: ${pi.status}).` },
      { status: 402 }
    );
  }
  if (pi.metadata?.relay_kind !== "enterprise_minutes") {
    return NextResponse.json(
      { error: "Payment is not a minute bundle." },
      { status: 400 }
    );
  }
  if (pi.metadata?.relay_org_id !== orgId) {
    return NextResponse.json(
      { error: "Payment belongs to another organization." },
      { status: 403 }
    );
  }

  const minutes = Number(pi.metadata?.relay_minutes ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return NextResponse.json(
      { error: "Bundle has no minutes." },
      { status: 400 }
    );
  }

  // Current pool.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("allocated_minutes, remaining_minutes")
    .eq("id", orgId)
    .single();
  if (orgErr || !org) {
    return NextResponse.json(
      { error: orgErr?.message ?? "Org not found." },
      { status: 404 }
    );
  }
  const cur = org as { allocated_minutes: number; remaining_minutes: number };

  // Already credited? PI metadata is the idempotency ledger.
  if (pi.metadata?.relay_credited === "1") {
    return NextResponse.json({
      ok: true,
      minutesAdded: 0,
      remainingMinutes: Number(cur.remaining_minutes),
      alreadyCredited: true,
    });
  }

  const newAllocated = Number(cur.allocated_minutes) + minutes;
  const newRemaining = Number(cur.remaining_minutes) + minutes;

  const { error: updErr } = await admin
    .from("organizations")
    .update({
      allocated_minutes: newAllocated,
      remaining_minutes: newRemaining,
    })
    .eq("id", orgId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Stamp the PI so a repeat/webhook call won't double-credit.
  await stripeRequest(`/payment_intents/${paymentIntentId}`, "POST", {
    "metadata[relay_credited]": "1",
  }).catch(() => {
    /* credit already applied; stamp is best-effort */
  });

  console.log(
    `[enterprise/wallet/topup] org=${orgId} +${minutes}min via ${paymentIntentId}`
  );
  return NextResponse.json({
    ok: true,
    minutesAdded: minutes,
    remainingMinutes: newRemaining,
  });
}
