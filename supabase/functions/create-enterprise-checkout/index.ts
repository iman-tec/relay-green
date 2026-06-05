// Creates a Stripe PaymentIntent for an enterprise plan upgrade.
//
// Body: { tier: "starter" | "pro" | "business" | "enterprise" }
//
// Caller must be an authenticated Supabase user holding the
// 'enterprise_admin' role with a non-null profiles.organization_id.
// We stash org_id + tier on the PaymentIntent metadata so the webhook
// (payments-webhook) can flip organizations.plan_tier on payment_intent.succeeded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@22.0.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_KEY =
  Deno.env.get("STRIPE_SANDBOX_API_KEY") ??
  Deno.env.get("STRIPE_LIVE_API_KEY") ??
  "";

// Mirror of lib/billing/plans.ts (no shared module across Deno + Node).
// Enterprise tier has no fixed price — sales-led, blocks checkout here.
const PLANS: Record<string, { name: string; priceCents: number }> = {
  starter: { name: "Relay Starter — monthly", priceCents: 4900 },
  pro: { name: "Relay Pro — monthly", priceCents: 19900 },
  business: { name: "Relay Business — monthly", priceCents: 49900 },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    if (!STRIPE_KEY) {
      return new Response(
        JSON.stringify({ error: "STRIPE key not configured on the project" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await sb.auth.getUser();
    if (uErr || !u.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Role + org gate. We rely on RLS to also block cross-org reads in
    // queries the caller can't see; here we just check the caller is an
    // enterprise_admin with a profile org binding.
    const [{ data: roles }, { data: profile }] = await Promise.all([
      sb.from("user_role_names").select("role").eq("user_id", u.user.id),
      sb
        .from("profiles")
        .select("organization_id")
        .eq("id", u.user.id)
        .maybeSingle(),
    ]);
    const isEntAdmin = (roles ?? []).some(
      (r: { role: string }) => r.role === "enterprise_admin"
    );
    const orgId = (profile as { organization_id?: string } | null)
      ?.organization_id;
    if (!isEntAdmin || !orgId) {
      return new Response(
        JSON.stringify({ error: "Forbidden — not an enterprise admin." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const tier: string | undefined = body.tier;
    if (!tier || !PLANS[tier]) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid tier (enterprise tier is contact-sales — no checkout).",
          valid: Object.keys(PLANS),
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const p = PLANS[tier];
    const intent = await stripe.paymentIntents.create({
      amount: p.priceCents,
      currency: "eur",
      payment_method_types: ["card"],
      description: p.name,
      // || not ?? — empty-string email must become undefined (Stripe rejects
      // an empty receipt_email with "Invalid email address").
      receipt_email: u.user.email || undefined,
      metadata: {
        relay_kind: "enterprise_plan",
        relay_org_id: orgId,
        relay_tier: tier,
        relay_actor_id: u.user.id,
      },
    });

    return new Response(
      JSON.stringify({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: p.priceCents,
        plan_name: p.name,
        tier,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const stripeMeta =
      err && typeof err === "object"
        ? {
            type: (err as { type?: string }).type,
            code: (err as { code?: string }).code,
            status: (err as { statusCode?: number }).statusCode,
          }
        : {};
    console.error("[create-enterprise-checkout]", msg, stripeMeta);
    return new Response(JSON.stringify({ error: msg, stripe: stripeMeta }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
