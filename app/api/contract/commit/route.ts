/*
 * POST /api/contract/commit
 *   Body: { quoteId, paymentIntentId }
 *   Server-verifies the PaymentIntent succeeded for this quote + customer,
 *   then commits the contract (status='committed', paid_at, committed_at).
 *   Idempotent — a repeat call on an already-committed quote is a no-op.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { stripeRequest, STRIPE_KEY } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PaymentIntent = {
  id: string;
  status: string;
  metadata: Record<string, string>;
};

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  if (!STRIPE_KEY)
    return NextResponse.json(
      { error: "Stripe key not configured." },
      { status: 500 }
    );

  const { quoteId, paymentIntentId } = (await request
    .json()
    .catch(() => ({}))) as { quoteId?: string; paymentIntentId?: string };
  if (!quoteId || !paymentIntentId || !/^pi_/.test(paymentIntentId)) {
    return NextResponse.json(
      { error: "Missing quoteId or paymentIntentId." },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: q } = await admin
    .from("project_quote_requests")
    .select("id, customer_user_id, status, kind, project_id")
    .eq("id", quoteId)
    .maybeSingle();
  const quote = q as {
    customer_user_id: string;
    status: string;
    kind: string;
    project_id: string;
  } | null;
  if (!quote)
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  if (quote.customer_user_id !== user.id)
    return NextResponse.json({ error: "Not your quote." }, { status: 403 });
  if (quote.status === "committed")
    return NextResponse.json({ ok: true, alreadyCommitted: true });
  if (quote.status !== "quoted")
    return NextResponse.json({ error: "Quote isn't open." }, { status: 409 });

  const pi = await stripeRequest<PaymentIntent>(
    `/payment_intents/${paymentIntentId}`,
    "GET"
  );
  if (pi.status !== "succeeded")
    return NextResponse.json(
      { error: `Payment not completed (${pi.status}).` },
      { status: 402 }
    );
  if (
    pi.metadata?.relay_kind !== "contract" ||
    pi.metadata?.relay_quote_id !== quoteId ||
    pi.metadata?.relay_user_id !== user.id
  ) {
    return NextResponse.json(
      { error: "Payment doesn't match this contract." },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("project_quote_requests")
    .update({
      status: "committed",
      payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
      committed_at: new Date().toISOString(),
    })
    .eq("id", quoteId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Commit flips the project's engagement type, so engineer/pod golive +
  // maintain KPIs reflect the new contract.
  if (quote.kind === "golive" || quote.kind === "maintain") {
    await admin
      .from("projects")
      .update({ contract_type: quote.kind })
      .eq("id", quote.project_id);
  }

  return NextResponse.json({ ok: true });
}
