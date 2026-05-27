/*
 * POST /api/contract/checkout
 *   Body: { quoteId }
 *   Creates a Stripe PaymentIntent for the bid amount on a quoted contract.
 *   The customer must own the quote and it must be in 'quoted' state.
 *   Returns: { clientSecret, paymentIntentId, amountCents }
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { stripeRequest, STRIPE_KEY } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type PaymentIntent = { id: string; client_secret: string | null };

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  if (!STRIPE_KEY) return NextResponse.json({ error: "Stripe key not configured." }, { status: 500 });

  const { quoteId } = (await request.json().catch(() => ({}))) as { quoteId?: string };
  if (!quoteId) return NextResponse.json({ error: "Missing quoteId." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: q } = await admin
    .from("project_quote_requests")
    .select("id, customer_user_id, status, quote_amount_cents, kind, project_id")
    .eq("id", quoteId).maybeSingle();
  const quote = q as { id: string; customer_user_id: string; status: string; quote_amount_cents: number | null; kind: string; project_id: string } | null;
  if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  if (quote.customer_user_id !== user.id) return NextResponse.json({ error: "Not your quote." }, { status: 403 });
  if (quote.status !== "quoted") return NextResponse.json({ error: "This quote isn't open for payment." }, { status: 409 });
  const amount = Number(quote.quote_amount_cents ?? 0);
  if (amount <= 0) return NextResponse.json({ error: "Quote has no amount." }, { status: 400 });

  const intent = await stripeRequest<PaymentIntent>("/payment_intents", "POST", {
    amount,
    currency: "eur",
    "payment_method_types[0]": "card",
    description: `Relay ${quote.kind === "golive" ? "go-live" : "maintenance"} contract`,
    receipt_email: user.email || undefined,
    "metadata[relay_kind]": "contract",
    "metadata[relay_quote_id]": quote.id,
    "metadata[relay_user_id]": user.id,
  });

  return NextResponse.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id, amountCents: amount });
}
