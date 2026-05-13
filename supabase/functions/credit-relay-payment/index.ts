// Server-verified wallet credit for a Stripe PaymentIntent.
//
// Called by the client immediately after stripe.confirmPayment() resolves
// without an error. We:
//   1. Verify the PaymentIntent's status === 'succeeded' against Stripe's API
//      (the client is not trusted — anyone could POST a random pi_… id).
//   2. Check the PI's metadata.relay_user_id matches the authenticated user.
//   3. Credit the wallet idempotently — dedupes on credit_transactions
//      .stripe_session_id, so a parallel webhook call won't double-credit.
//
// This makes the wallet update work even when the Stripe Dashboard webhook
// endpoint isn't subscribed to payment_intent.succeeded (a common
// misconfiguration trap). The webhook keeps working in parallel as a
// belt-and-braces — first one in wins, second one finds the dedupe row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@22.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON             = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY                =
  Deno.env.get("STRIPE_SANDBOX_API_KEY")
  ?? Deno.env.get("STRIPE_LIVE_API_KEY")
  ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!STRIPE_KEY) {
      return new Response(JSON.stringify({ error: "STRIPE key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Input ───────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const paymentIntentId: string | undefined = body.payment_intent_id;
    if (!paymentIntentId || typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) {
      return new Response(JSON.stringify({ error: "Invalid payment_intent_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify against Stripe ──────────────────────────────────────────────
    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
      httpClient: Stripe.createFetchHttpClient(),
    });
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded") {
      return new Response(JSON.stringify({ error: `PaymentIntent not succeeded: ${intent.status}` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const piUserId = intent.metadata?.relay_user_id;
    const plan     = intent.metadata?.relay_plan;
    const minutes  = Number(intent.metadata?.relay_minutes ?? "0");
    if (!piUserId || !plan || !Number.isFinite(minutes) || minutes <= 0) {
      return new Response(JSON.stringify({ error: "PaymentIntent missing Relay metadata" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Don't let user A credit a PI that belonged to user B.
    if (piUserId !== u.user.id) {
      return new Response(JSON.stringify({ error: "PaymentIntent does not belong to this user" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Credit (idempotent) ────────────────────────────────────────────────
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await admin
      .from("credit_transactions")
      .select("id")
      .eq("stripe_session_id", intent.id)
      .maybeSingle();
    if (existing) {
      // Already credited (either by us on a retry, or by the webhook).
      const { data: w } = await admin
        .from("credit_wallets")
        .select("balance")
        .eq("user_id", piUserId)
        .maybeSingle();
      return new Response(JSON.stringify({
        ok: true, dedup: true, balance: Number(w?.balance ?? 0),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Wallet upsert
    const { data: wallet } = await admin
      .from("credit_wallets")
      .select("balance, lifetime_purchased")
      .eq("user_id", piUserId)
      .maybeSingle();
    if (wallet) {
      await admin
        .from("credit_wallets")
        .update({
          balance:            Number(wallet.balance ?? 0) + minutes,
          lifetime_purchased: Number(wallet.lifetime_purchased ?? 0) + minutes,
          updated_at:         new Date().toISOString(),
        })
        .eq("user_id", piUserId);
    } else {
      await admin.from("credit_wallets").insert({
        user_id: piUserId,
        balance: minutes,
        lifetime_purchased: minutes,
        lifetime_spent: 0,
      });
    }

    await admin.from("credit_transactions").insert({
      user_id: piUserId,
      delta: minutes,
      reason: `relay_plan:${plan}`,
      stripe_session_id: intent.id,
    });

    await admin
      .from("customer_entitlements")
      .upsert({ customer_user_id: piUserId }, { onConflict: "customer_user_id" });
    const { data: ent } = await admin
      .from("customer_entitlements")
      .select("paid_minutes_remaining, paid_minutes_lifetime, total_paid_cents")
      .eq("customer_user_id", piUserId)
      .maybeSingle();
    if (ent) {
      await admin.from("customer_entitlements").update({
        paid_minutes_remaining: Number(ent.paid_minutes_remaining ?? 0) + minutes,
        paid_minutes_lifetime:  Number(ent.paid_minutes_lifetime ?? 0) + minutes,
        total_paid_cents:       Number(ent.total_paid_cents ?? 0) + Number(intent.amount ?? 0),
        updated_at:             new Date().toISOString(),
      }).eq("customer_user_id", piUserId);
    }

    const { data: post } = await admin
      .from("credit_wallets")
      .select("balance")
      .eq("user_id", piUserId)
      .maybeSingle();

    return new Response(JSON.stringify({
      ok: true,
      credited: minutes,
      balance:  Number(post?.balance ?? 0),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[credit-relay-payment]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
