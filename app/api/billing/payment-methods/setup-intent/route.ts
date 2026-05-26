/*
 * POST /api/billing/payment-methods/setup-intent
 *
 * Creates a Stripe SetupIntent so the customer can add a payment method
 * (card on file) without being charged. The client confirms the
 * SetupIntent with Stripe Elements (PaymentElement in "setup" mode);
 * Stripe attaches the resulting PaymentMethod to the customer's Stripe
 * Customer object automatically.
 *
 * If the Relay customer doesn't have a Stripe Customer yet, we lazily
 * create one and persist the id back to customer_entitlements (column
 * added by migration 20260527100000_customer_stripe_customer_id.sql).
 *
 * No body required. Returns: { clientSecret, customerId }.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Force Node.js runtime — direct Stripe REST calls are simpler from
// Node than from the Edge runtime (no extra fetch polyfill concerns).
export const runtime = "nodejs";

const STRIPE_KEY =
  process.env.STRIPE_SANDBOX_API_KEY ??
  process.env.STRIPE_LIVE_API_KEY ??
  process.env.STRIPE_SECRET_KEY ??
  "";

// Helper: call Stripe REST API with form-urlencoded body (their default).
// The Stripe Node SDK does this under the hood; we open-code it to avoid
// adding a dependency for this one feature surface.
async function stripeRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, string | number | undefined>,
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
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(url, init);
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Stripe ${method} ${path} failed (${res.status})`);
  }
  return json;
}

export async function POST() {
  if (!STRIPE_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured on this environment." },
      { status: 500 },
    );
  }

  const sb = await createClient();
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const userId = u.user.id;
  const email = u.user.email ?? undefined;

  // Look up the existing stripe_customer_id (if any).
  const { data: entRow } = await sb
    .from("customer_entitlements")
    .select("stripe_customer_id")
    .eq("customer_user_id", userId)
    .maybeSingle();
  let stripeCustomerId: string | null =
    (entRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;

  // Create + persist a Stripe Customer if we don't have one yet. This
  // is the lazy-create path — most customers won't have one until they
  // visit Billing for the first time.
  if (!stripeCustomerId) {
    try {
      const created = await stripeRequest<{ id: string }>("/customers", "POST", {
        email,
        "metadata[relay_user_id]": userId,
      });
      stripeCustomerId = created.id;
      // Persist so future calls (list, delete, future checkouts) can
      // reuse the same customer. Upsert because customer_entitlements
      // might not have a row yet for this customer.
      await sb.from("customer_entitlements").upsert(
        { customer_user_id: userId, stripe_customer_id: stripeCustomerId },
        { onConflict: "customer_user_id" },
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Couldn't create Stripe customer." },
        { status: 502 },
      );
    }
  }

  // Create the SetupIntent. `card` only for now (matches the existing
  // checkout flow); switch to `automatic_payment_methods: { enabled: true }`
  // later if we want to surface SEPA / wallets / etc.
  try {
    const intent = await stripeRequest<{ client_secret: string; id: string }>(
      "/setup_intents",
      "POST",
      {
        customer: stripeCustomerId,
        "payment_method_types[]": "card",
        usage: "off_session",
      },
    );
    return NextResponse.json({
      clientSecret: intent.client_secret,
      customerId: stripeCustomerId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't create SetupIntent." },
      { status: 502 },
    );
  }
}
