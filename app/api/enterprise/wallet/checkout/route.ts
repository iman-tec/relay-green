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
import { partnerProgramEnabled } from "@/lib/billing/partnerProgram";
import { effectiveBundleCents, isDiscountActive } from "@/lib/billing/partnerMargin";

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

  // Org name for the receipt description + the partner discount fields. The
  // discount fields already exist (set at onboarding via /api/reseller/...);
  // they only affect the charged price when the partner program flag is on AND
  // the discount is active. For every other org this resolves to the list
  // price and the request is identical to before — the recharge mechanism and
  // the minute-crediting RPC are untouched (minutes always credit 1:1).
  const { data: org } = await admin
    .from("organizations")
    .select("name, discount_pct, discount_until, reseller_id")
    .eq("id", orgId)
    .maybeSingle();
  const orgRow = org as {
    name?: string;
    discount_pct?: number | null;
    discount_until?: string | null;
    reseller_id?: string | null;
  } | null;
  const orgName = orgRow?.name ?? "your organization";

  const discountPct = Number(orgRow?.discount_pct ?? 0);
  const discountUntil = orgRow?.discount_until ?? null;
  const applyDiscount =
    partnerProgramEnabled() &&
    !!orgRow?.reseller_id &&
    isDiscountActive(discountPct, discountUntil);
  const chargeCents = applyDiscount
    ? effectiveBundleCents(bundle.amountCents, discountPct, discountUntil)
    : bundle.amountCents;

  const intent = await stripeRequest<PaymentIntent>(
    "/payment_intents",
    "POST",
    {
      amount: chargeCents,
      currency: "eur",
      "payment_method_types[0]": "card",
      description: `Relay minutes — ${bundle.label} (${bundle.minutes.toLocaleString()} min) for ${orgName}`,
      receipt_email: actor.email || undefined,
      "metadata[relay_kind]": "enterprise_minutes",
      "metadata[relay_org_id]": orgId,
      "metadata[relay_minutes]": String(bundle.minutes),
      "metadata[relay_actor_id]": actor.id,
      "metadata[relay_bundle]": bundle.code,
      // Audit trail for margin accrual (only stamped when a discount applied).
      ...(applyDiscount
        ? {
            "metadata[relay_list_cents]": String(bundle.amountCents),
            "metadata[relay_discount_pct]": String(discountPct),
            "metadata[relay_partner_id]": String(orgRow?.reseller_id),
          }
        : {}),
    }
  );

  return NextResponse.json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amountCents: chargeCents,
    listAmountCents: bundle.amountCents,
    discountApplied: applyDiscount,
    minutes: bundle.minutes,
    bundleLabel: bundle.label,
  });
}
