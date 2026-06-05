/*
 * POST /api/enterprise/wallet/checkout
 *
 * Creates a Stripe PaymentIntent for a prepaid minute bundle. The client
 * confirms it with Stripe Elements (PaymentElement), then calls
 * /api/enterprise/wallet/topup to credit the org's minute pool once the
 * PaymentIntent reaches `succeeded`.
 *
 * Body: { bundleCode: 'starter' | 'team' | 'scale' }
 * Returns: { clientSecret, paymentIntentId, amountCents, minutes, bundleLabel }
 *
 * Caller must be an enterprise_admin with a profiles.organization_id.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { stripeRequest, STRIPE_KEY } from "@/lib/stripe/server";
import { bundleByCode } from "@/lib/billing/minuteBundles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PaymentIntent = { id: string; client_secret: string | null };

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user: actor } = gate;

  if (!STRIPE_KEY) {
    return NextResponse.json(
      { error: "Stripe key not configured for this build." },
      { status: 500 }
    );
  }

  const { bundleCode } = (await request.json().catch(() => ({}))) as {
    bundleCode?: string;
  };
  const bundle = bundleCode ? bundleByCode(bundleCode) : undefined;
  if (!bundle) {
    return NextResponse.json({ error: "Unknown bundle." }, { status: 400 });
  }

  // Org name for the receipt description.
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const orgName =
    (org as { name?: string } | null)?.name ?? "your organization";

  const intent = await stripeRequest<PaymentIntent>(
    "/payment_intents",
    "POST",
    {
      amount: bundle.amountCents,
      currency: "eur",
      "payment_method_types[0]": "card",
      description: `Relay minutes — ${bundle.label} (${bundle.minutes.toLocaleString()} min) for ${orgName}`,
      receipt_email: actor.email || undefined,
      "metadata[relay_kind]": "enterprise_minutes",
      "metadata[relay_org_id]": orgId,
      "metadata[relay_minutes]": String(bundle.minutes),
      "metadata[relay_actor_id]": actor.id,
      "metadata[relay_bundle]": bundle.code,
    }
  );

  return NextResponse.json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amountCents: bundle.amountCents,
    minutes: bundle.minutes,
    bundleLabel: bundle.label,
  });
}
