// Stripe webhook for Relay support-pack purchases.
//
// Handles `payment_intent.succeeded` for PaymentIntents created via
// /functions/v1/create-relay-checkout (the support-pack purchase path).
// Credits the customer's wallet with the minutes encoded in metadata.
//
// (We also still handle `checkout.session.completed` for any legacy
// Stripe Checkout flows that might still be in flight — same payload
// shape for metadata extraction, different id field for dedupe.)
//
// Idempotent: dedupes by the Stripe object id stored in
// credit_transactions.stripe_session_id (the column name is historical;
// it now holds either a checkout session id or a payment_intent id).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET     = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

async function verifyAndParse(req: Request): Promise<{ id: string; type: string; data: { object: Record<string, unknown> } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  if (!signature || !body) throw new Error("Missing signature or body");
  if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET not configured");

  let timestamp: string | undefined;
  const v1: string[] = [];
  for (const part of signature.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t") timestamp = v;
    if (k === "v1") v1.push(v);
  }
  if (!timestamp || v1.length === 0) throw new Error("Invalid signature format");
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = new TextDecoder().decode(encode(new Uint8Array(sig)));
  if (!v1.includes(expected)) throw new Error("Invalid webhook signature");
  return JSON.parse(body);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const event = await verifyAndParse(req);
    // Accept both event types — PaymentIntent succeeded is the new path,
    // CheckoutSession completed is the legacy path. Same metadata shape
    // on both objects, different id semantics for dedupe.
    if (event.type !== "payment_intent.succeeded" && event.type !== "checkout.session.completed") {
      return new Response(JSON.stringify({ received: true, ignored: event.type }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const obj = event.data.object as {
      id: string;
      metadata?: { relay_user_id?: string; relay_plan?: string; relay_minutes?: string };
      amount?:       number; // PaymentIntent
      amount_total?: number; // CheckoutSession
    };
    const userId = obj.metadata?.relay_user_id;
    const plan   = obj.metadata?.relay_plan;
    const minutes = Number(obj.metadata?.relay_minutes ?? "0");
    if (!userId || !plan || !Number.isFinite(minutes) || minutes <= 0) {
      console.warn("[relay-stripe-webhook] missing metadata", obj.metadata);
      return new Response(JSON.stringify({ received: true, note: "missing metadata" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Idempotency: dedupe by the Stripe object id (PaymentIntent.id or
    // CheckoutSession.id). The column name stays `stripe_session_id` for
    // schema compatibility — it's just a unique identifier slot.
    const { data: existing } = await admin
      .from("credit_transactions")
      .select("id")
      .eq("stripe_session_id", obj.id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ received: true, dedup: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert wallet
    const { data: wallet } = await admin
      .from("credit_wallets")
      .select("balance, lifetime_purchased")
      .eq("user_id", userId)
      .maybeSingle();

    if (wallet) {
      await admin
        .from("credit_wallets")
        .update({
          balance: Number(wallet.balance ?? 0) + minutes,
          lifetime_purchased: Number(wallet.lifetime_purchased ?? 0) + minutes,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } else {
      await admin.from("credit_wallets").insert({
        user_id: userId,
        balance: minutes,
        lifetime_purchased: minutes,
        lifetime_spent: 0,
      });
    }

    // Ledger row
    await admin.from("credit_transactions").insert({
      user_id: userId,
      delta: minutes,
      reason: `relay_plan:${plan}`,
      stripe_session_id: obj.id,
    });

    // Also reflect on customer_entitlements.paid_minutes_remaining
    await admin
      .from("customer_entitlements")
      .upsert({ customer_user_id: userId }, { onConflict: "customer_user_id" });
    const { data: ent } = await admin
      .from("customer_entitlements")
      .select("paid_minutes_remaining, paid_minutes_lifetime, total_paid_cents")
      .eq("customer_user_id", userId)
      .maybeSingle();
    if (ent) {
      const amountCents = Number(obj.amount ?? obj.amount_total ?? 0);
      await admin.from("customer_entitlements").update({
        paid_minutes_remaining: Number(ent.paid_minutes_remaining ?? 0) + minutes,
        paid_minutes_lifetime:  Number(ent.paid_minutes_lifetime ?? 0) + minutes,
        total_paid_cents:       Number(ent.total_paid_cents ?? 0) + amountCents,
        updated_at:             new Date().toISOString(),
      }).eq("customer_user_id", userId);
    }

    return new Response(JSON.stringify({ received: true, credited: minutes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[relay-stripe-webhook]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
