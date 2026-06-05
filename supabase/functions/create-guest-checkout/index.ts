// Creates an embedded Stripe checkout session for a guest to extend their session.
// No auth required: guest provides email + card.
import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const guestCallId: string | undefined = body.guest_call_id;
    const guestName: string | undefined = body.guest_name;
    const email: string | undefined = body.email;
    const minutes: number = Number(body.minutes ?? 30);
    const amountCents: number = Number(body.amount_cents ?? 1500);
    const returnUrl: string | undefined = body.return_url;
    const env: StripeEnv = body.env === "live" ? "live" : "sandbox";

    if (!guestCallId || !email || !returnUrl) {
      return new Response(
        JSON.stringify({
          error: "Missing guest_call_id, email, or return_url",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (amountCents < 50) {
      return new Response(JSON.stringify({ error: "Amount too low" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = createStripeClient(env);
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Relay session — ${minutes} extra minutes`,
              description: guestName ? `For ${guestName}` : undefined,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: `${returnUrl}&session_id={CHECKOUT_SESSION_ID}`,
      customer_email: email,
      metadata: {
        kind: "guest_extension",
        guest_call_id: guestCallId,
        minutes: String(minutes),
        guest_email: email,
      },
      payment_intent_data: {
        metadata: {
          kind: "guest_extension",
          guest_call_id: guestCallId,
          minutes: String(minutes),
          guest_email: email,
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
    console.error("create-guest-checkout error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
