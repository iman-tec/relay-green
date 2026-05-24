// Creates a Stripe PaymentIntent for one of the Relay support packs.
//
// Body: { plan: "base" | "pro" | "max" }
//
// Caller must be an authenticated Supabase user. We store user_id +
// minutes on the PaymentIntent metadata so the webhook can credit the
// wallet on `payment_intent.succeeded`.
//
// Switched from Stripe Checkout Sessions (hosted/embedded iframe whose
// styling we couldn't control) to a raw PaymentIntent + Stripe Elements
// on the client. That lets us render a dark-themed payment form inside
// our own modal, no Stripe Dashboard branding dependency.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@22.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON     = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_KEY        =
  Deno.env.get("STRIPE_SANDBOX_API_KEY")
  ?? Deno.env.get("STRIPE_LIVE_API_KEY")
  ?? "";

const PLANS: Record<string, { minutes: number; priceCents: number; name: string }> = {
  base: { minutes: 100, priceCents: 5000,  name: "Relay Base — 100 minutes"  },
  pro:  { minutes: 240, priceCents: 10000, name: "Relay Pro — 240 minutes"   },
  max:  { minutes: 500, priceCents: 20000, name: "Relay Max — 500 minutes"   },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!STRIPE_KEY) {
      return new Response(JSON.stringify({ error: "STRIPE key not configured on the project" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await user.auth.getUser();
    if (uErr || !u.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const plan: string | undefined = body.plan;
    if (!plan || !PLANS[plan]) {
      return new Response(JSON.stringify({ error: "Invalid plan", valid: Object.keys(PLANS) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pin to a stable, well-tested Stripe API version.
    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const p = PLANS[plan];
    const intent = await stripe.paymentIntents.create({
      amount:   p.priceCents,
      currency: "eur",
      // Card-only — no Link / wallets / regional methods. Keeps the form
      // single-purpose for now. To open up to more methods later, swap
      // `payment_method_types` for `automatic_payment_methods: { enabled: true }`.
      payment_method_types: ["card"],
      description: p.name,
      // Use || (not ??) so an empty-string email — anonymous/guest users
      // have email "" — becomes undefined rather than "" (Stripe rejects an
      // empty receipt_email with "Invalid email address"). Registered users
      // still get their real receipt email.
      receipt_email: u.user.email || undefined,
      metadata: {
        relay_user_id: u.user.id,
        relay_plan:    plan,
        relay_minutes: String(p.minutes),
        relay_plan_name: p.name,
      },
    });

    return new Response(JSON.stringify({
      client_secret:     intent.client_secret,
      payment_intent_id: intent.id,
      amount_cents:      p.priceCents,
      plan_name:         p.name,
      minutes:           p.minutes,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Surface the Stripe error type/code in logs so we can diagnose without
    // having to enable debug mode end-to-end. Also include in the response
    // body — never leaks secrets, only Stripe error metadata.
    const stripeMeta = (err && typeof err === "object")
      ? {
          type:    (err as { type?: string }).type,
          code:    (err as { code?: string }).code,
          param:   (err as { param?: string }).param,
          status:  (err as { statusCode?: number }).statusCode,
        }
      : {};
    console.error("[create-relay-checkout]", msg, stripeMeta);
    return new Response(JSON.stringify({ error: msg, stripe: stripeMeta }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
