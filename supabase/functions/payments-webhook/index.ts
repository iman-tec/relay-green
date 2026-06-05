// Stripe webhook: credits a user's wallet after a successful credit-package purchase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }
  return _supabase;
}

async function handleCheckoutCompleted(session: any, _env: StripeEnv) {
  const meta = session.metadata ?? {};
  if (session.payment_status !== "paid") {
    console.log("Checkout not paid yet", session.id, session.payment_status);
    return;
  }

  // ── Relay support plan (Base / Pro / Max) ───────────────────────────
  // Minted by /functions/v1/create-relay-checkout. Credits the
  // credit_wallets + customer_entitlements tables for the user.
  if (meta.relay_user_id) {
    const userId = meta.relay_user_id as string;
    const plan = meta.relay_plan as string | undefined;
    const minutes = Number(meta.relay_minutes ?? 0);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      console.warn("[payments-webhook] relay plan with bad minutes", meta);
      return;
    }
    const supabase = getSupabase();

    // Idempotency: dedupe by stripe session id
    const { data: existing } = await supabase
      .from("credit_transactions")
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();
    if (existing) {
      console.log("[relay] already credited", session.id);
      return;
    }

    // Upsert wallet (Relay credits = minutes here)
    const { data: wallet } = await supabase
      .from("credit_wallets")
      .select("balance, lifetime_purchased")
      .eq("user_id", userId)
      .maybeSingle();
    if (wallet) {
      await supabase
        .from("credit_wallets")
        .update({
          balance:
            Number((wallet as { balance?: number }).balance ?? 0) + minutes,
          lifetime_purchased:
            Number(
              (wallet as { lifetime_purchased?: number }).lifetime_purchased ??
                0
            ) + minutes,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("credit_wallets").insert({
        user_id: userId,
        balance: minutes,
        lifetime_purchased: minutes,
        lifetime_spent: 0,
      });
    }

    // Ledger
    await supabase.from("credit_transactions").insert({
      user_id: userId,
      delta: minutes,
      reason: `relay_plan:${plan ?? "unknown"}`,
      stripe_session_id: session.id,
    });

    // Mirror onto customer_entitlements so the profile chip reflects it
    await supabase
      .from("customer_entitlements")
      .upsert({ customer_user_id: userId }, { onConflict: "customer_user_id" });
    const { data: ent } = await supabase
      .from("customer_entitlements")
      .select("paid_minutes_remaining, paid_minutes_lifetime, total_paid_cents")
      .eq("customer_user_id", userId)
      .maybeSingle();
    if (ent) {
      const e = ent as Record<string, number | null>;
      await supabase
        .from("customer_entitlements")
        .update({
          paid_minutes_remaining:
            Number(e.paid_minutes_remaining ?? 0) + minutes,
          paid_minutes_lifetime: Number(e.paid_minutes_lifetime ?? 0) + minutes,
          total_paid_cents:
            Number(e.total_paid_cents ?? 0) + Number(session.amount_total ?? 0),
          updated_at: new Date().toISOString(),
        })
        .eq("customer_user_id", userId);
    }
    console.log(`[relay] credited ${minutes} min to ${userId} (plan=${plan})`);

    // Auto-resume any expired_free session for this user — single
    // round trip, no client polling needed.
    const { data: expired } = await supabase
      .from("guest_calls")
      .select("id")
      .eq("customer_user_id", userId)
      .eq("status", "expired_free")
      .order("created_at", { ascending: false })
      .limit(1);
    if (expired && expired.length > 0) {
      const sessId = (expired[0] as { id: string }).id;
      const { error: extErr } = await supabase.rpc(
        "extend_session_paid_admin",
        { _session_id: sessId }
      );
      if (extErr)
        console.warn(
          `[relay] auto-extend failed for ${sessId}:`,
          extErr.message
        );
      else console.log(`[relay] auto-resumed session ${sessId}`);
    }
    return;
  }

  // Guest session extension: bump free_minutes on the guest_call.
  if (meta.kind === "guest_extension") {
    const callId = meta.guest_call_id;
    const addMinutes = Number(meta.minutes ?? 30);
    if (!callId) {
      console.error(
        "Missing guest_call_id in guest_extension session",
        session.id
      );
      return;
    }
    const supabase = getSupabase();
    const { data: call } = await supabase
      .from("guest_calls")
      .select("free_minutes, paid_extension_at")
      .eq("id", callId)
      .maybeSingle();
    const current =
      (call as { free_minutes?: number } | null)?.free_minutes ?? 30;
    const alreadyPaid = (call as { paid_extension_at?: string | null } | null)
      ?.paid_extension_at;
    const { error } = await supabase
      .from("guest_calls")
      .update({
        free_minutes: current + addMinutes,
        guest_email: meta.guest_email ?? null,
        // Stamp first-payment time. Subsequent extensions don't reset this —
        // the count-up timer should keep growing from the original payment.
        paid_extension_at: alreadyPaid ?? new Date().toISOString(),
      })
      .eq("id", callId);
    if (error) console.error("guest_calls update failed:", error);
    return;
  }

  if (meta.kind !== "credit_purchase") {
    console.log("Ignoring non-credit checkout", session.id);
    return;
  }
  const userId = meta.userId;
  const credits = Number(meta.credits);
  const packageCode = meta.packageCode;
  if (!userId || !credits) {
    console.error("Missing userId/credits in checkout session", session.id);
    return;
  }

  const { error } = await getSupabase().rpc("credit_credits", {
    _user_id: userId,
    _amount: credits,
    _reason: "purchase",
    _stripe_session_id: session.id,
    _description: `Purchased ${packageCode}`,
    _metadata: { stripe_payment_intent: session.payment_intent },
  });
  if (error) console.error("credit_credits failed:", error);
}

Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  const rawEnv = new URL(req.url).searchParams.get("env");
  if (rawEnv !== "sandbox" && rawEnv !== "live") {
    return new Response(
      JSON.stringify({ received: true, ignored: "invalid env" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  const env: StripeEnv = rawEnv;

  try {
    const event = await verifyWebhook(req, env);
    switch (event.type) {
      case "checkout.session.completed":
      case "transaction.completed":
        await handleCheckoutCompleted(event.data.object, env);
        break;
      default:
        console.log("Unhandled event:", event.type);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("payments-webhook error:", e);
    return new Response("Webhook error", { status: 400 });
  }
});
