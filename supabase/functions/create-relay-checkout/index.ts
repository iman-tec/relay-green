// Creates a Stripe Checkout session for one of the Relay support packs.
//
// Body: { plan: "base" | "pro" | "max", return_url: string }
//   - plan          → which support pack to charge for
//   - return_url    → where Stripe sends the user after success / cancel
//
// Caller must be an authenticated Supabase user. We store user_id +
// minutes on the session metadata so the webhook can credit the wallet.

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
    const returnUrl: string = String(body.return_url ?? "https://10.0.1.207:3000/room");
    if (!plan || !PLANS[plan]) {
      return new Response(JSON.stringify({ error: "Invalid plan", valid: Object.keys(PLANS) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2026-03-25.dahlia",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const p = PLANS[plan];
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: p.priceCents,
          product_data: { name: p.name },
        },
      }],
      customer_email: u.user.email ?? undefined,
      success_url: `${returnUrl}?relay_paid=${plan}`,
      cancel_url:  `${returnUrl}?relay_paid=cancelled`,
      metadata: {
        relay_user_id: u.user.id,
        relay_plan:    plan,
        relay_minutes: String(p.minutes),
      },
    });

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[create-relay-checkout]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
