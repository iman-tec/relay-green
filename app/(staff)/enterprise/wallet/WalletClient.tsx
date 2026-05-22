"use client";

/*
 * Enterprise Wallet — plan management for enterprise_admin.
 *
 * Layout:
 *   1. Current plan tile (status, renewal date)
 *   2. Plan grid (Starter / Pro / Business / Enterprise) — click to upgrade
 *   3. Inline Stripe Elements payment form when a paid plan is picked.
 *      Enterprise tier opens a mailto instead (contact sales).
 *
 * Mirrors the customer-side PaywallModal flow (create-enterprise-checkout
 * → PaymentIntent → confirmPayment → activate-plan), so the visual + UX
 * pattern is the same as how customers pay for credit packs.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, ArrowRight, ChevronLeft, CreditCard, Sparkles } from "lucide-react";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { createClient } from "@/lib/supabase/browser";
import { PLAN_CATALOG, formatEur, type PlanTier } from "@/lib/billing/plans";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

const STRIPE_PUBLISHABLE_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

type CurrentPlan = {
  tier: PlanTier;
  status: string;
  currentPeriodEnd: string | null;
};

export function WalletClient() {
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [loading, setLoading] = useState(true);

  // When set, we're showing the Stripe Elements payment form.
  const [checkout, setCheckout] = useState<{
    tier: PlanTier;
    clientSecret: string;
    paymentIntentId: string;
    amountCents: number;
    planName: string;
  } | null>(null);

  const [pickError, setPickError] = useState<string | null>(null);
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/enterprise/billing", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (body && !body.error) {
      setCurrent({
        tier:             body.plan.tier as PlanTier,
        status:           body.plan.status,
        currentPeriodEnd: body.plan.currentPeriodEnd,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onPickPlan = async (tier: PlanTier) => {
    setPickError(null);
    if (tier === "enterprise") {
      window.location.href = "mailto:sales@relay.green?subject=Enterprise%20plan%20enquiry";
      return;
    }
    if (current?.tier === tier && current?.status === "active") {
      setPickError("You're already on this plan.");
      return;
    }
    setBusyTier(tier);
    try {
      const sb = createClient();
      const { data, error } = await sb.functions.invoke("create-enterprise-checkout", {
        body: { tier },
      });
      const payload = data as {
        client_secret?: string; payment_intent_id?: string;
        amount_cents?: number; plan_name?: string;
        error?: string;
      } | null;
      const cs = payload?.client_secret;
      const pi = payload?.payment_intent_id;
      if (error || !cs || !pi) {
        let msg = error?.message ?? payload?.error ?? "Couldn't start checkout.";
        try {
          const ctx = (error as { context?: Response } | null)?.context;
          if (ctx && typeof ctx.json === "function") {
            const b = await ctx.json() as { error?: string };
            if (b?.error) msg = b.error;
          }
        } catch { /* ignore */ }
        setPickError(msg);
        return;
      }
      setCheckout({
        tier,
        clientSecret:    cs,
        paymentIntentId: pi,
        amountCents:     payload?.amount_cents ?? 0,
        planName:        payload?.plan_name ?? tier,
      });
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Couldn't start checkout.");
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Wallet</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Manage your Relay enterprise plan. All amounts in EUR (€).
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={18} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : checkout ? (
        <CheckoutPanel
          checkout={checkout}
          onBack={() => setCheckout(null)}
          onSuccess={async () => {
            // Once Stripe confirms, flip the plan locally. (In production,
            // the Stripe webhook should be the source of truth — this
            // call is the synchronous demo-friendly path.)
            await fetch("/api/enterprise/wallet/activate-plan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tier: checkout.tier,
                paymentIntentId: checkout.paymentIntentId,
              }),
            });
            setCheckout(null);
            await refresh();
          }}
        />
      ) : (
        <>
          <CurrentPlanTile current={current} />
          {pickError && (
            <div
              className="rounded-md border px-3 py-2 text-[12px]"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
                color: "var(--accent-red)",
              }}
            >
              {pickError}
            </div>
          )}
          <PlanGrid
            current={current}
            busyTier={busyTier}
            onPick={onPickPlan}
          />
          <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
            Card payments secured by Stripe. EUR pricing only.
          </p>
        </>
      )}
    </div>
  );
}

function CurrentPlanTile({ current }: { current: CurrentPlan | null }) {
  if (!current) {
    return (
      <div
        className="rounded-xl border px-5 py-6"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>No plan info loaded.</p>
      </div>
    );
  }
  const def = PLAN_CATALOG[current.tier];
  const renews = current.currentPeriodEnd
    ? new Date(current.currentPeriodEnd).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;
  const statusBadge = (() => {
    if (current.status === "active")   return { label: "Active",   fg: BRAND_GREEN, bg: BRAND_GREEN_SOFT };
    if (current.status === "trialing") return { label: "Trial",    fg: BRAND_GREEN, bg: BRAND_GREEN_SOFT };
    if (current.status === "past_due") return { label: "Past due", fg: "var(--accent-red)", bg: "color-mix(in srgb, var(--accent-red) 12%, transparent)" };
    return { label: current.status,    fg: "var(--text-muted)",   bg: "color-mix(in srgb, var(--text-muted) 12%, transparent)" };
  })();

  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            Current plan
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-2xl font-semibold" style={{ color: "var(--text)" }}>{def.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: statusBadge.bg, color: statusBadge.fg }}
            >
              {statusBadge.label}
            </span>
          </div>
          <div className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {def.monthlyPriceCents != null ? `${formatEur(def.monthlyPriceCents)} / month` : "Custom pricing"}
            {renews && ` · renews ${renews}`}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanGrid({
  current, busyTier, onPick,
}: {
  current: CurrentPlan | null;
  busyTier: PlanTier | null;
  onPick: (tier: PlanTier) => void;
}) {
  const tiers: PlanTier[] = ["starter", "pro", "business", "enterprise"];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiers.map((t) => (
        <PlanCard
          key={t}
          tier={t}
          isCurrent={current?.tier === t && current?.status === "active"}
          busy={busyTier === t}
          onPick={() => onPick(t)}
        />
      ))}
    </div>
  );
}

function PlanCard({
  tier, isCurrent, busy, onPick,
}: {
  tier: PlanTier;
  isCurrent: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const def = PLAN_CATALOG[tier];
  const featured = tier === "pro"; // visual emphasis on the most popular tier

  return (
    <div
      className="relative flex flex-col rounded-xl border p-5"
      style={{
        borderColor: featured && !isCurrent ? BRAND_GREEN : "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {featured && !isCurrent && (
        <span
          className="absolute -top-2 left-4 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          <Sparkles size={9} /> Most popular
        </span>
      )}
      {isCurrent && (
        <span
          className="absolute -top-2 left-4 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          <Check size={9} /> Current
        </span>
      )}

      <div className="text-base font-semibold" style={{ color: "var(--text)" }}>{def.name}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: "var(--text)", fontFeatureSettings: "'tnum' 1" }}>
        {def.monthlyPriceCents != null ? formatEur(def.monthlyPriceCents) : "Custom"}
        {def.monthlyPriceCents != null && (
          <span className="ml-1 text-[12px] font-normal" style={{ color: "var(--text-muted)" }}>/ month</span>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-snug" style={{ color: "var(--text-muted)" }}>
        {def.description}
      </p>
      <ul className="mt-3 flex-1 space-y-1.5">
        {def.features.map((f, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[12px]" style={{ color: "var(--text)" }}>
            <Check size={11} className="mt-0.5 shrink-0" style={{ color: BRAND_GREEN }} />
            {f}
          </li>
        ))}
      </ul>

      <button
        onClick={onPick}
        disabled={isCurrent || busy}
        className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
        style={{
          backgroundColor: isCurrent ? "transparent" : BRAND_GREEN,
          border: isCurrent ? "1px solid var(--border)" : "1px solid transparent",
          color: isCurrent ? "var(--text-muted)" : "#fff",
        }}
      >
        {busy ? (
          <>
            <Loader2 size={11} className="animate-spin" /> Preparing…
          </>
        ) : isCurrent ? (
          "Active"
        ) : tier === "enterprise" ? (
          <>
            Contact sales <ArrowRight size={11} />
          </>
        ) : (
          <>
            <CreditCard size={11} /> Upgrade
          </>
        )}
      </button>
    </div>
  );
}

/* ──────── Stripe Elements payment form ──────── */

const DARK_APPEARANCE: Appearance = {
  theme: "night",
  labels: "floating",
  variables: {
    colorPrimary:    BRAND_GREEN,
    colorBackground: "#141413",
    colorText:       "#f5f2ec",
    colorTextSecondary: "#c7c5bd",
    colorTextPlaceholder: "#7c7a73",
    colorDanger:     "#e88670",
    fontFamily:      "Inter, system-ui, -apple-system, sans-serif",
    borderRadius:    "8px",
  },
};

function CheckoutPanel({
  checkout, onBack, onSuccess,
}: {
  checkout: {
    tier: PlanTier; clientSecret: string; paymentIntentId: string;
    amountCents: number; planName: string;
  };
  onBack: () => void;
  onSuccess: () => Promise<void>;
}) {
  if (!stripePromise) {
    return (
      <div
        className="rounded-xl border p-6 text-center"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <p className="mb-3 text-sm" style={{ color: "var(--text)" }}>
          Stripe publishable key isn&apos;t configured for this environment.
        </p>
        <p className="mb-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
          Set <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> in your env, then refresh.
        </p>
        <button
          onClick={onBack}
          className="rounded-md border px-3 py-1.5 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          Back to plans
        </button>
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronLeft size={12} /> Back to plans
        </button>
        <div className="text-[12px]" style={{ color: "var(--text)" }}>
          {checkout.planName} · {formatEur(checkout.amountCents)}
        </div>
      </div>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: checkout.clientSecret,
          appearance:   DARK_APPEARANCE,
          loader:       "auto",
        }}
      >
        <CheckoutForm
          amountCents={checkout.amountCents}
          planName={checkout.planName}
          tier={checkout.tier}
          paymentIntentId={checkout.paymentIntentId}
          onSuccess={onSuccess}
        />
      </Elements>
    </div>
  );
}

function CheckoutForm({
  amountCents, planName, tier, paymentIntentId, onSuccess,
}: {
  amountCents: number;
  planName: string;
  tier: PlanTier;
  paymentIntentId: string;
  onSuccess: () => Promise<void>;
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
            ? `${window.location.origin}/enterprise/wallet?tier=${tier}&pi=${paymentIntentId}`
            : "/enterprise/wallet",
      },
      redirect: "if_required",
    });
    if (error) {
      setPayError(error.message ?? "Payment failed.");
      setSubmitting(false);
      return;
    }
    await onSuccess();
  };

  return (
    <div className="space-y-4 px-5 py-5">
      <PaymentElement options={{ layout: "tabs" }} />
      {payError && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {payError}
        </div>
      )}
      <button
        onClick={() => void onPay()}
        disabled={!stripe || !elements || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: BRAND_GREEN }}
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Processing…
          </>
        ) : (
          <>
            Pay {formatEur(amountCents)}
            <ArrowRight size={14} />
          </>
        )}
      </button>
      <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
        {planName} · Secured by Stripe
      </p>
    </div>
  );
}
