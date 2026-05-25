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
import { Loader2, X, ArrowRight, Check, ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { GuestUpgradeForm } from "@/app/_components/GuestUpgradeForm";
import { SUPPORT_PLANS, type SupportPlanCode } from "@/lib/relay/pricing";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { buildStripeAppearance } from "@/lib/stripe/appearance";
import { useTheme } from "@/app/_components/ThemeProvider";

// Single Stripe.js loader for the whole app — Stripe recommends not
// re-loading on every modal open. Returns null at build time on the server.
const STRIPE_PUBLISHABLE_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

// Aligned with the rest of the app: same brand green as supervise/admin,
// same surface/border/text tokens as ConnectingModal + the customer chat.
const BRAND_GREEN = "var(--primary)";
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
  // Anonymous (guest) users have no email, so checkout can't issue a receipt
  // or charge. When a guest picks a paid plan we first show a sign-up gate;
  // pendingPlan holds the plan to resume once they've created an account.
  const [isGuest, setIsGuest] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<SupportPlanCode | null>(null);
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

  const checkout = async (plan: SupportPlanCode, skipGuestGate = false) => {
    // Guests must register before paying — they have no email for the
    // receipt/charge. Show the sign-up gate and resume on success.
    // skipGuestGate is passed right after a successful upgrade, where the
    // isGuest state hasn't flushed yet but we know they now have an email.
    if (isGuest && !skipGuestGate) {
      setError(null);
      setPendingPlan(plan);
      return;
    }
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
      setPendingPlan(null);
    }
  }, [open]);

  // Detect whether the current user is an anonymous guest when the paywall
  // opens — drives the sign-up gate before checkout.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const sb = createClient();
    void sb.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setIsGuest(Boolean(data.user?.is_anonymous) || (!!data.user && !data.user.email));
    });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  // Guest sign-up gate — shown after a guest picks a paid plan. On success
  // they're a permanent account with an email, so we resume checkout.
  if (pendingPlan) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        style={{ backgroundColor: BACKDROP, backdropFilter: "blur(4px)" }}
      >
        <div
          className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl"
          style={{ backgroundColor: SURFACE, borderColor: CARD_EDGE, color: INK }}
        >
          <button
            onClick={() => setPendingPlan(null)}
            className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-opacity hover:opacity-100"
            style={{ color: INK_SOFT, opacity: 0.8 }}
            aria-label="Back to plans"
          >
            <ChevronLeft size={14} />
            Back
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
            style={{ color: INK_SOFT }}
          >
            <X size={16} />
          </button>
          <div className="mt-6">
            <GuestUpgradeForm
              heading="Create your account to continue"
              blurb="Your free session is saved. Add an email and password to top up minutes and keep the same engineer."
              ctaLabel="Create account & continue"
              onUpgraded={() => {
                const plan = pendingPlan;
                setIsGuest(false);
                setPendingPlan(null);
                void checkout(plan, true);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const eyebrow =
    reason === "free_expired" ? "Pick up where you left off."
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
              Keep going with your engineer.
              <br />
              <span style={{ fontStyle: "italic", color: INK_SOFT }}>Pay only for the time you use.</span>
            </h1>
            <p
              className="mx-auto mt-3 max-w-md text-[13px]"
              style={{ color: INK_SOFT }}
            >
              Your first 10 minutes were on us. Top up whenever you want more —
              credits stay good for 12 months.
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

          {/* Plan grid. The Free card is suppressed on the free_expired
              path — the user has already consumed their free session, so
              showing it again is clutter, not choice. On the no_credits /
              default paths it remains, since a first-time visitor still
              benefits from seeing the no-card-required entry point.

              Highlight (Pro) gets the solid-green CTA; other paid cards
              get a quieter outline CTA so the three pricing options
              don't read as three competing shouts. */}
          <p
            className="mb-3 text-[12px]"
            style={{ color: INK_SOFT }}
          >
            Each session is minimum 10 minutes. Use credits across as many
            sessions as you need.
          </p>
          {(() => {
            const visiblePlans = SUPPORT_PLANS.filter(
              (p) => !(reason === "free_expired" && p.code === "free"),
            );
            const cols = visiblePlans.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4";
            return (
              <div className={`grid grid-cols-2 gap-2.5 ${cols}`}>
                {visiblePlans.map((p) => {
                  const busy = busyPlan === p.code;
                  const isPaid = p.purchasable;
                  const isHighlight = "highlight" in p ? !!p.highlight : false;
                  return (
                    <PlanCard
                      key={p.code}
                      name={p.name}
                      priceLabel={p.cta}
                      suffix={p.minutes > 0 ? `/ ${p.minutes} min` : ""}
                      blurb={p.blurb}
                      features={[...p.features]}
                      highlight={isHighlight}
                      ctaLabel={isPaid ? `Continue with ${p.cta}` : "Start free"}
                      ctaInteractive={isPaid}
                      ctaSolid={isHighlight || !isPaid}
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
            );
          })()}

          {/* Trust strip — the two biggest hidden fears a payer has,
              defused in one calm line. No icons, no green emphasis —
              sits like fine print but is read. */}
          <div
            className="mx-auto mt-6 max-w-2xl text-center text-[12px] leading-relaxed"
            style={{ color: INK_MUTE }}
          >
            No subscription &middot; No auto-renew
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
// The highlight ring on the recommended card is intentionally subtle (a
// 1px green border, no badge, no sparkle). Pricing modals that shout
// "POPULAR" feel like discount sites; a quiet ring + a solid CTA on the
// same card communicates the same recommendation without the marketing
// pressure.
//
// ctaSolid controls whether the bottom button is the loud filled-green
// pill (highlight card + the free entry) or the quieter outline pill
// (other paid cards). One strong invitation, several quiet alternates.
function PlanCard({
  name, priceLabel, suffix, blurb, features, highlight, ctaLabel, ctaInteractive, ctaSolid, busy, onClick,
}: {
  name: string;
  priceLabel: string;
  suffix: string;
  blurb: string;
  features: string[];
  highlight: boolean;
  ctaLabel: string;
  ctaInteractive: boolean;
  ctaSolid: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="relative flex h-full flex-col rounded-xl border p-3.5"
      style={{
        borderColor: highlight ? BRAND_GREEN : CARD_EDGE,
        backgroundColor: CARD,
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: INK_MUTE }}>
        {name}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="text-2xl font-medium tabular-nums"
          style={{
            color: INK,
            fontFamily: "var(--font-source-serif)",
            letterSpacing: "-0.02em",
          }}
        >
          {priceLabel}
        </span>
        {suffix && (
          <span className="text-[12px]" style={{ color: INK_MUTE }}>
            {suffix}
          </span>
        )}
      </div>

      <p
        className="mt-2.5 text-[13px] leading-snug"
        style={{ color: INK_SOFT }}
      >
        {blurb}
      </p>

      <ul
        className="mt-3 flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: CARD_EDGE }}
      >
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-[13px] leading-snug"
            style={{ color: INK_SOFT }}
          >
            <Check size={12} style={{ color: BRAND_GREEN, marginTop: 3, flexShrink: 0 }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-all hover:opacity-90 disabled:opacity-50"
        style={{
          marginTop: 16,
          padding: "10px 14px",
          backgroundColor: ctaInteractive && ctaSolid ? BRAND_GREEN : "transparent",
          color: ctaInteractive && ctaSolid ? "#fff" : ctaInteractive ? BRAND_GREEN : INK,
          border: ctaInteractive && ctaSolid ? "none" : `1px solid ${ctaInteractive ? BRAND_GREEN : CARD_EDGE}`,
        }}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : null}
        {busy ? "Loading…" : ctaLabel}
        {!busy && ctaInteractive && <ArrowRight size={13} />}
      </button>
    </div>
  );
}


// ── Stripe Elements payment form ───────────────────────────────────────────
// Builds the payment form from Stripe Elements (PaymentElement). Unlike
// Stripe Checkout (hosted or embedded), Elements accepts a full
// `appearance` config so we can match the rest of the app — light or
// dark. See lib/stripe/appearance.ts; appearance is rebuilt at the
// moment Elements mounts and the parent remounts on theme change.

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
  // Read the theme via the provider so this Elements tree remounts
  // (via key={theme}) whenever the user flips the toggle — Stripe
  // doesn't observe DOM changes, so a fresh appearance has to come
  // through a re-render with a new key.
  const { theme } = useTheme();
  return (
    <Elements
      key={theme}
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: buildStripeAppearance(),
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
