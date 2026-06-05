// Creates a Stripe Embedded Checkout session for a credit package.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: uerr } = await userClient.auth.getUser();
    if (uerr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const packageCode: string | undefined = body.package_code;
    const returnUrl: string | undefined = body.return_url;
    const envParam: StripeEnv =
      body.env === "live" ? "live" : ("sandbox" as StripeEnv);

    if (!packageCode || !returnUrl) {
      return new Response(
        JSON.stringify({ error: "Missing package_code or return_url" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: pkg } = await admin
      .from("credit_packages")
      .select("*")
      .eq("code", packageCode)
      .eq("active", true)
      .maybeSingle();

    if (!pkg) {
      return new Response(JSON.stringify({ error: "Package not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = createStripeClient(envParam);

    // Resolve our human-readable price id (e.g. "credits_500") into a stripe price id
    const prices = await stripe.prices.search({
      query: `metadata['lovable_external_id']:'${pkg.code}'`,
      limit: 1,
    });
    const stripePrice = prices.data[0];
    if (!stripePrice) {
      return new Response(
        JSON.stringify({ error: "Stripe price not found for package" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        userId,
        packageCode: pkg.code,
        credits: String(pkg.credits),
        kind: "credit_purchase",
      },
      payment_intent_data: {
        metadata: {
          userId,
          packageCode: pkg.code,
          credits: String(pkg.credits),
          kind: "credit_purchase",
        },
      },
    });

    return new Response(
      JSON.stringify({
        client_secret: session.client_secret,
        session_id: session.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("create-credits-checkout error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
