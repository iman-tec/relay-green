"use client";

/*
 * Relay paywall — brand-aligned "Three phases. One team." info page.
 *
 * Layout mirrors the public pricing section: warm cream backdrop, three
 * cards side-by-side, serif headings + JetBrains-mono prices, black pill
 * CTA at the bottom of each card.
 *
 * On Phase 01: each PAID row (Base / Pro / Max) is independently clickable
 * → Stripe Checkout. Free row is informational only. The bottom card-CTA is
 * a "Get in touch" mailto for custom requests.
 *
 * Phase 02 / Phase 03: single Get-in-touch mailto.
 *
 * Triggered by:
 *   - free 10-min cap hit (status=expired_free) — 10-min buffer counts down
 *   - session ended with reason=free_session_expired
 *   - new-session attempt with no entitlement (manual)
 */

import { useEffect, useState } from "react";
import { Loader2, X, ArrowRight, Check, ChevronLeft, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { SUPPORT_PLANS, LAUNCH_PLANS, RETAINER, type SupportPlanCode } from "@/lib/relay/pricing";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

// Single Stripe.js loader for the whole app — Stripe recommends not
// re-loading on every modal open. Returns null at build time on the server.
const STRIPE_PUBLISHABLE_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

// Aligned with the rest of the app: same brand green as supervise/admin,
// same surface/border/text tokens as ConnectingModal + the customer chat.
const BRAND_GREEN = "#3f5c2e";
const SURFACE     = "var(--surface)";
const CARD        = "var(--surface)";
const CARD_EDGE   = "var(--border)";
const INK         = "var(--text)";
const INK_SOFT    = "color-mix(in srgb, var(--text) 78%, transparent)";
const INK_MUTE    = "var(--text-muted)";
const BACKDROP    = "rgba(0, 0, 0, 0.55)";

export function PaywallModal({
  open, reason, onClose,
}: {
  open: boolean;
  reason: "free_expired" | "no_credits" | "manual";
  onClose: () => void;
}) {
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When set, we're showing the Stripe Elements payment form for this plan.
  // null = show the plan-selection grid.
  const [activeCheckout, setActiveCheckout] = useState<{
    plan: SupportPlanCode;
    clientSecret: string;
    paymentIntentId: string;
    amountCents: number;
    planName: string;
    minutes: number;
  } | null>(null);

  const checkout = async (plan: SupportPlanCode) => {
    setBusyPlan(plan);
    setError(null);
    try {
      const sb = createClient();
      const { data, error: e } = await sb.functions.invoke("create-relay-checkout", {
        body: {
          plan,
          return_url: typeof window !== "undefined" ? `${window.location.origin}/room` : "/room",
        },
      });
      const payload = data as {
        client_secret?: string;
        payment_intent_id?: string;
        amount_cents?: number;
        plan_name?:    string;
        minutes?:      number;
      } | null;
      const clientSecret = payload?.client_secret;
      const paymentIntentId = payload?.payment_intent_id;
      if (e || !clientSecret || !paymentIntentId) {
        // supabase-js wraps non-2xx responses; the real Stripe error lives
        // in error.context (the raw Response). Read it so the user sees
        // something actionable instead of "non-2xx status code".
        let detail = e?.message ?? (data as { error?: string } | null)?.error ?? "Could not start checkout";
        try {
          const ctx = (e as { context?: Response } | null)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json() as { error?: string; stripe?: { type?: string; code?: string } };
            if (body?.error) detail = body.stripe?.code ? `${body.error} [${body.stripe.code}]` : body.error;
          }
        } catch { /* swallow parse errors, fall back to outer message */ }
        setError(detail);
        return;
      }
      setActiveCheckout({
        plan,
        clientSecret,
        paymentIntentId,
        amountCents: payload?.amount_cents ?? 0,
        planName:    payload?.plan_name ?? plan,
        minutes:     payload?.minutes ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyPlan(null);
    }
  };

  // Reset embedded checkout state whenever the paywall is closed externally
  // so re-opening doesn't show a stale Stripe iframe for a previous attempt.
  useEffect(() => {
    if (!open) {
      setActiveCheckout(null);
      setBusyPlan(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const eyebrow =
    reason === "free_expired" ? "Your free 10 minutes are up"
    : reason === "no_credits" ? "Pick a plan to continue"
    : "Relay plans";

  // When the user has clicked a paid plan, we mount Stripe's embedded
  // Checkout inside the modal instead of the plan grid. Closing the
  // embedded view (back arrow / X / Escape) returns to the grid.
  if (activeCheckout) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        style={{ backgroundColor: BACKDROP, backdropFilter: "blur(4px)" }}
      >
        <div
          className="relative w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
          style={{ backgroundColor: SURFACE, borderColor: CARD_EDGE, color: INK }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-5 py-3.5"
            style={{ borderColor: CARD_EDGE }}
          >
            <button
              onClick={() => setActiveCheckout(null)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-opacity hover:opacity-100"
              style={{ color: INK_SOFT, opacity: 0.8 }}
              aria-label="Back to plans"
            >
              <ChevronLeft size={14} />
              Back
            </button>
            <div className="text-[12px] font-medium" style={{ color: INK }}>
              {activeCheckout.planName}{activeCheckout.minutes ? ` · ${activeCheckout.minutes} min` : ""}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
              style={{ color: INK_SOFT }}
            >
              <X size={14} />
            </button>
          </div>
          <PaymentForm
            clientSecret={activeCheckout.clientSecret}
            paymentIntentId={activeCheckout.paymentIntentId}
            amountCents={activeCheckout.amountCents}
            planName={activeCheckout.planName}
            plan={activeCheckout.plan}
            onCancel={() => setActiveCheckout(null)}
          />
        </div>
      </div>
    );
  }
  // planMeta is unused now that PaymentForm handles plan display itself —
  // kept the lookup deliberately removed for clarity.

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ backgroundColor: BACKDROP, backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-5xl rounded-2xl border shadow-2xl"
        style={{ backgroundColor: SURFACE, borderColor: CARD_EDGE, color: INK }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
          style={{ color: INK_SOFT }}
        >
          <X size={16} />
        </button>

        <div className="px-6 pb-7 pt-7 md:px-10 md:pb-9 md:pt-9">
          {/* Eyebrow + title */}
          <div className="mb-7 text-center">
            <div
              className="mb-2 inline-block text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: INK_MUTE }}
            >
              {eyebrow}
            </div>
            <h1
              className="mx-auto max-w-2xl text-2xl font-medium leading-[1.1] md:text-3xl"
              style={{
                fontFamily: "var(--font-source-serif)",
                color: INK,
                letterSpacing: "-0.02em",
              }}
            >
              Pay only for what you need.{" "}
              <span style={{ fontStyle: "italic", color: INK_SOFT }}>Same engineer the whole way.</span>
            </h1>
            <p
              className="mx-auto mt-3 max-w-md text-[13px]"
              style={{ color: INK_SOFT }}
            >
              Start with a free 10-minute session. Top up minutes whenever you need an
              engineer — credits stay good for 12 months.
            </p>
          </div>

          {error && (
            <div
              className="mx-auto mb-4 max-w-md rounded-md border px-3 py-2 text-center text-xs"
              style={{
                borderColor: "rgba(139, 26, 26, 0.4)",
                backgroundColor: "rgba(139, 26, 26, 0.12)",
                color: "#e88670",
              }}
            >
              {error}
            </div>
          )}

          {/* Build (pay-as-you-go) */}
          <SectionLabel>Build — pay-as-you-go credits</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {SUPPORT_PLANS.map((p) => {
              const busy = busyPlan === p.code;
              const isPaid = p.purchasable;
              return (
                <PlanCard
                  key={p.code}
                  name={p.name}
                  priceLabel={p.cta}
                  suffix={p.minutes > 0 ? `/ ${p.minutes} min` : ""}
                  blurb={p.blurb}
                  features={[...p.features]}
                  highlight={"highlight" in p ? !!p.highlight : false}
                  ctaLabel={isPaid ? `Buy ${p.cta}` : "Start free"}
                  ctaInteractive={isPaid}
                  busy={busy}
                  onClick={
                    isPaid
                      ? () => void checkout(p.code as SupportPlanCode)
                      : onClose
                  }
                />
              );
            })}
          </div>

          {/* Launch + retainer */}
          <div className="mt-4">
            <SectionLabel>Launch & retainer — quoted on complexity</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {LAUNCH_PLANS.map((p) => (
                <PlanCard
                  key={p.code}
                  name={p.name}
                  priceLabel={p.priceLabel}
                  suffix={p.suffix}
                  blurb={p.blurb}
                  features={[...p.features]}
                  highlight={false}
                  ctaLabel="Get in touch"
                  ctaInteractive={false}
                  busy={false}
                  onClick={() => {
                    window.location.href = `mailto:support@relay.green?subject=Relay%20—%20${encodeURIComponent(p.name)}%20launch%20project`;
                  }}
                />
              ))}
              <PlanCard
                name={RETAINER.name}
                priceLabel={RETAINER.priceLabel}
                suffix={RETAINER.suffix}
                blurb={RETAINER.blurb}
                features={[...RETAINER.features]}
                highlight={false}
                ctaLabel="Get in touch"
                ctaInteractive={false}
                busy={false}
                onClick={() => {
                  window.location.href = "mailto:support@relay.green?subject=Relay%20—%20Monthly%20retainer";
                }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
      style={{ color: INK_MUTE }}
    >
      {children}
    </div>
  );
}

// ── Plan card (compact) ────────────────────────────────────────────────────
function PlanCard({
  name, priceLabel, suffix, blurb, features, highlight, ctaLabel, ctaInteractive, busy, onClick,
}: {
  name: string;
  priceLabel: string;
  suffix: string;
  blurb: string;
  features: string[];
  highlight: boolean;
  ctaLabel: string;
  ctaInteractive: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="relative flex h-full flex-col rounded-xl border p-3"
      style={{
        borderColor: highlight ? BRAND_GREEN : CARD_EDGE,
        backgroundColor: CARD,
        boxShadow: highlight ? `0 0 0 1px ${BRAND_GREEN} inset` : undefined,
      }}
    >
      {highlight && (
        <div
          className="absolute -top-2 left-3 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em]"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          <Sparkles size={8} />
          Popular
        </div>
      )}

      <div className="text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK_MUTE }}>
        {name}
      </div>

      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className="text-xl font-medium tabular-nums"
          style={{
            color: INK,
            fontFamily: "var(--font-source-serif)",
            letterSpacing: "-0.02em",
          }}
        >
          {priceLabel}
        </span>
        {suffix && (
          <span className="text-[10px]" style={{ color: INK_MUTE }}>
            {suffix}
          </span>
        )}
      </div>

      <p
        className="mt-1.5 line-clamp-2 text-[11px] leading-snug"
        style={{ color: INK_SOFT }}
      >
        {blurb}
      </p>

      <ul
        className="mt-2 flex flex-col gap-1 border-t pt-2"
        style={{ borderColor: CARD_EDGE }}
      >
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-1.5 text-[11px] leading-snug"
            style={{ color: INK_SOFT }}
          >
            <Check size={10} style={{ color: BRAND_GREEN, marginTop: 3, flexShrink: 0 }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        disabled={busy}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{
          backgroundColor: ctaInteractive ? BRAND_GREEN : "transparent",
          color: ctaInteractive ? "#fff" : INK,
          border: ctaInteractive ? "none" : `1px solid ${CARD_EDGE}`,
        }}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : null}
        {busy ? "Loading…" : ctaLabel}
        {!busy && ctaInteractive && <ArrowRight size={11} />}
      </button>
    </div>
  );
}


// ── Stripe Elements payment form ───────────────────────────────────────────
// Builds the payment form from Stripe Elements (PaymentElement). Unlike
// Stripe Checkout (hosted or embedded), Elements accepts a full `appearance`
// config so we can force a dark theme that matches the rest of the app —
// no Stripe Dashboard branding dependency.

const DARK_APPEARANCE: Appearance = {
  theme: "night",
  labels: "floating",
  variables: {
    colorPrimary:    BRAND_GREEN,
    colorBackground: SURFACE,
    colorText:       INK,
    colorTextSecondary: INK_SOFT,
    colorTextPlaceholder: INK_MUTE,
    colorDanger:     "#e88670",
    fontFamily:      "Inter, system-ui, -apple-system, sans-serif",
    borderRadius:    "8px",
  },
  rules: {
    ".Input": {
      backgroundColor: CARD,
      border: `1px solid ${CARD_EDGE}`,
      color: INK,
    },
    ".Input:focus": {
      borderColor: BRAND_GREEN,
      boxShadow: `0 0 0 2px rgba(93, 138, 68, 0.2)`,
    },
    ".Label": {
      color: INK_SOFT,
    },
    ".Tab, .Block": {
      backgroundColor: CARD,
      border: `1px solid ${CARD_EDGE}`,
    },
    ".Tab:hover": {
      borderColor: BRAND_GREEN,
    },
    ".Tab--selected": {
      borderColor: BRAND_GREEN,
      backgroundColor: SURFACE,
    },
  },
};

function PaymentForm({
  clientSecret, paymentIntentId, amountCents, planName, plan, onCancel,
}: {
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  planName: string;
  plan: SupportPlanCode;
  onCancel: () => void;
}) {
  if (!stripePromise) {
    return (
      <div className="px-6 py-10 text-center" style={{ color: INK_SOFT }}>
        <div
          className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(139, 26, 26, 0.15)", color: "#e88670" }}
        >
          <X size={16} />
        </div>
        <p className="mb-4 text-[13px]">Stripe publishable key not configured.</p>
        <button
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-[12px] transition-opacity hover:opacity-80"
          style={{ borderColor: CARD_EDGE, color: INK }}
        >
          Back to plans
        </button>
      </div>
    );
  }
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: DARK_APPEARANCE,
        loader: "auto",
      }}
    >
      <PaymentFormInner
        paymentIntentId={paymentIntentId}
        amountCents={amountCents}
        planName={planName}
        plan={plan}
      />
    </Elements>
  );
}

function PaymentFormInner({
  paymentIntentId, amountCents, planName, plan,
}: {
  paymentIntentId: string;
  amountCents: number;
  planName: string;
  plan: SupportPlanCode;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const onPay = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setPayError(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/room?relay_paid=${plan}`
            : "/room",
      },
      // Cards resolve in-place; only methods that need it (3DS, redirects)
      // navigate away.
      redirect: "if_required",
    });
    if (error) {
      setPayError(error.message ?? "Payment failed");
      setSubmitting(false);
      return;
    }

    // Synchronous success path: trigger a server-side credit immediately,
    // so the wallet updates even if the Stripe Dashboard webhook isn't
    // subscribed to payment_intent.succeeded. Idempotent: if the webhook
    // does fire in parallel, it finds the dedupe row and no-ops.
    try {
      const sb = createClient();
      const { error: creditErr } = await sb.functions.invoke("credit-relay-payment", {
        body: { payment_intent_id: paymentIntentId },
      });
      if (creditErr) {
        // Surface but don't block — webhook may still credit shortly.
        console.warn("[paywall] credit-relay-payment failed:", creditErr.message);
      }
    } catch (e) {
      console.warn("[paywall] credit call threw:", e);
    }

    if (typeof window !== "undefined") {
      window.location.assign(`${window.location.origin}/room?relay_paid=${plan}`);
    }
  };

  const priceEuro = (amountCents / 100).toFixed(2);

  return (
    <div className="space-y-4 px-5 pb-5 pt-4" style={{ backgroundColor: SURFACE }}>
      {/* Card-only — the PaymentIntent was created with payment_method_types:['card'],
       *  so PaymentElement won't even offer Link / wallets / etc. */}
      <PaymentElement options={{ layout: "tabs" }} />

      {payError && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: "rgba(139, 26, 26, 0.4)",
            backgroundColor: "rgba(139, 26, 26, 0.10)",
            color: "#e88670",
          }}
        >
          {payError}
        </div>
      )}

      <button
        onClick={() => void onPay()}
        disabled={!stripe || !elements || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-opacity disabled:opacity-50"
        style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Processing…
          </>
        ) : (
          <>
            Pay €{priceEuro}
            <ArrowRight size={14} />
          </>
        )}
      </button>

      <p className="text-center text-[10px]" style={{ color: INK_MUTE }}>
        {planName} · Secured by Stripe
      </p>
    </div>
  );
}
