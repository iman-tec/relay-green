/*
 * GET    /api/billing/payment-methods           — list saved cards
 * DELETE /api/billing/payment-methods?id=pm_xxx — detach a card
 *
 * Both routes resolve the customer's Stripe Customer id from
 * customer_entitlements (column added by migration
 * 20260527100000_customer_stripe_customer_id.sql). If the customer
 * has never added a card, the GET returns an empty list.
 *
 * Returns a normalized PaymentMethod shape so the client UI doesn't
 * have to know Stripe API specifics:
 *   { id, brand, last4, expMonth, expYear, isDefault }
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const STRIPE_KEY =
  process.env.STRIPE_SANDBOX_API_KEY ??
  process.env.STRIPE_LIVE_API_KEY ??
  process.env.STRIPE_SECRET_KEY ??
  "";

type StripePaymentMethod = {
  id: string;
  card?: {
    brand?: string;
    last4?: string;
    exp_month?: number;
    exp_year?: number;
  };
};

type StripeCustomer = {
  id: string;
  invoice_settings?: {
    default_payment_method?: string | null;
  };
};

async function stripeRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, string | number | undefined>
): Promise<T> {
  const url = `https://api.stripe.com/v1${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Stripe-Version": "2024-06-20",
    },
  };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) form.set(k, String(v));
    }
    init.body = form.toString();
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/x-www-form-urlencoded";
  }
  const res = await fetch(url, init);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(
      json?.error?.message ?? `Stripe ${method} ${path} failed (${res.status})`
    );
  }
  return json;
}

// Resolve the authenticated customer's Stripe Customer id. Returns null
// if the customer has never added a payment method (no Stripe Customer
// has been created for them yet — that's the no-op path for the GET).
async function getStripeCustomerId(): Promise<{
  stripeCustomerId: string | null;
  error?: { status: number; message: string };
}> {
  if (!STRIPE_KEY) {
    return {
      stripeCustomerId: null,
      error: { status: 500, message: "Stripe is not configured." },
    };
  }
  const sb = await createClient();
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u.user) {
    return {
      stripeCustomerId: null,
      error: { status: 401, message: "Not authenticated." },
    };
  }
  const { data: row } = await sb
    .from("customer_entitlements")
    .select("stripe_customer_id")
    .eq("customer_user_id", u.user.id)
    .maybeSingle();
  return {
    stripeCustomerId:
      (row as { stripe_customer_id?: string | null } | null)
        ?.stripe_customer_id ?? null,
  };
}

// ── GET ───────────────────────────────────────────────────────────────
export async function GET() {
  const { stripeCustomerId, error } = await getStripeCustomerId();
  if (error)
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  if (!stripeCustomerId) {
    // Customer hasn't added a card yet — empty list is the right shape,
    // not a 404. The client UI distinguishes "no cards yet" from "you
    // are not authorized."
    return NextResponse.json({ paymentMethods: [] });
  }

  try {
    // Pull the customer's default PM id + the actual PM list in parallel.
    // Stripe doesn't expose the default on PaymentMethod list directly —
    // it lives on Customer.invoice_settings.default_payment_method.
    const [customer, list] = await Promise.all([
      stripeRequest<StripeCustomer>(`/customers/${stripeCustomerId}`, "GET"),
      stripeRequest<{ data: StripePaymentMethod[] }>(
        `/customers/${stripeCustomerId}/payment_methods?type=card&limit=50`,
        "GET"
      ),
    ]);
    const defaultId = customer.invoice_settings?.default_payment_method ?? null;

    const paymentMethods = (list.data ?? []).map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "card",
      last4: pm.card?.last4 ?? "••••",
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      isDefault: pm.id === defaultId,
    }));
    return NextResponse.json({ paymentMethods });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Couldn't list payment methods.",
      },
      { status: 502 }
    );
  }
}

// ── DELETE ────────────────────────────────────────────────────────────
// Detaches a PaymentMethod from the customer. PaymentMethods are
// idempotent — once detached, they can't be reattached without going
// through a new SetupIntent.
export async function DELETE(req: Request) {
  const { stripeCustomerId, error } = await getStripeCustomerId();
  if (error)
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer." }, { status: 404 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !id.startsWith("pm_")) {
    return NextResponse.json(
      { error: "Missing or invalid payment method id." },
      { status: 400 }
    );
  }

  // Security check: make sure the PM actually belongs to this customer
  // before detaching. Stripe's detach endpoint doesn't verify this; we
  // do it explicitly so a malicious actor can't iterate pm_ ids to nuke
  // other customers' cards by id.
  try {
    const pm = await stripeRequest<{ customer: string | null }>(
      `/payment_methods/${id}`,
      "GET"
    );
    if (pm.customer !== stripeCustomerId) {
      return NextResponse.json(
        { error: "Not your payment method." },
        { status: 403 }
      );
    }
    await stripeRequest<{ id: string }>(
      `/payment_methods/${id}/detach`,
      "POST"
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Couldn't remove payment method.",
      },
      { status: 502 }
    );
  }
}
