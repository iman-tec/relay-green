"use client";

/*
 * Wallet — the company's prepaid minute pool (pay-per-minute, no
 * subscription). Shows available / used / distributed minutes, a low-balance
 * nudge, and minute bundles purchasable via Stripe. Buying a bundle tops up
 * the org pool: PaymentIntent (checkout) → confirm (Elements) → server credit
 * (topup), all org-scoped to the caller.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Zap,
  TrendingDown,
  Layers,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button, EmptyState } from "@/app/_components/ui";
import { useTheme } from "@/app/_components/ThemeProvider";
import { buildStripeAppearance } from "@/lib/stripe/appearance";
import { useApiData, eur, num, LoadingState, ErrorState } from "./_shared";
import { TabTitle, StatCard, PrimaryButton } from "./_kit";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";

const STRIPE_PUBLISHABLE_KEY =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) ||
  "";

let _stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise() {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  if (!_stripePromise) _stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return _stripePromise;
}

type Bundle = {
  code: string;
  label: string;
  minutes: number;
  amountCents: number;
};
type WalletData = {
  currency: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  distributedMinutes: number;
  perMinuteCents: number;
  bundles: Bundle[];
};

const LOW_BALANCE_MIN = 120; // nudge under ~2 hours left

export function WalletTab() {
  const { data, loading, error, reload } = useApiData<WalletData>(
    "/api/enterprise/wallet"
  );
  const [buying, setBuying] = useState<Bundle | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ErrorState message="No wallet data" onRetry={reload} />;

  const free = Math.max(0, data.remainingMinutes - data.distributedMinutes);
  const low = data.remainingMinutes <= LOW_BALANCE_MIN;

  return (
    <section>
      <TabTitle
        title="Wallet"
        sub="Prepaid minutes · pay-per-minute, no subscription. Buy minutes once — they never expire."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Wallet size={16} />}
          value={num(data.remainingMinutes)}
          label="Minutes available"
        />
        <StatCard
          icon={<Zap size={16} />}
          value={num(data.usedMinutes)}
          label="Minutes used"
        />
        <StatCard
          icon={<Layers size={16} />}
          value={num(data.distributedMinutes)}
          label="Distributed"
          hint="to departments"
        />
        <StatCard
          icon={<TrendingDown size={16} />}
          value={num(free)}
          label="Undistributed"
        />
      </div>

      {low && (
        <div
          className="mt-4 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--warn)",
            background: "color-mix(in srgb, var(--warn) 10%, transparent)",
            color: "var(--text)",
          }}
        >
          Low balance — {num(data.remainingMinutes)} minutes left. Top up to
          keep sessions running.
        </div>
      )}

      <section className="mt-6">
        <h2
          className="mb-3 text-sm font-semibold"
          style={{ color: "var(--text)" }}
        >
          Buy minutes
        </h2>
        {data.bundles.length === 0 ? (
          <EmptyState
            compact
            title="No bundles available"
            body="Contact your account manager."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {data.bundles.map((b) => {
              const perMin = Math.round(b.amountCents / b.minutes);
              return (
                <div
                  key={b.code}
                  className="flex flex-col rounded-2xl border p-5"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  <div
                    className="text-sm font-semibold"
                    style={{ color: "var(--text)" }}
                  >
                    {b.label}
                  </div>
                  <div
                    className="mt-1 font-serif text-3xl tabular-nums"
                    style={{ color: "var(--text)" }}
                  >
                    {num(b.minutes)}
                    <span
                      className="ml-1 text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      min
                    </span>
                  </div>
                  <div
                    className="mt-1 text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {eur(perMin)}/min · billed by the second
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span
                      className="font-serif text-lg tabular-nums"
                      style={{ color: "var(--text)" }}
                    >
                      {eur(b.amountCents)}
                    </span>
                    <PrimaryButton onClick={() => setBuying(b)}>
                      Buy
                    </PrimaryButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {buying && (
        <BuyBundleModal
          bundle={buying}
          onClose={() => setBuying(null)}
          onCredited={() => {
            setBuying(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

// ── Purchase modal — mirrors the customer wallet recharge flow ───────────
// Exported so the v2 Recharge view can reuse the exact Stripe money path
// (checkout → Elements → topup) without rebuilding it.
export function BuyBundleModal({
  bundle,
  onClose,
  onCredited,
}: {
  bundle: Bundle;
  onClose: () => void;
  onCredited: () => void;
}) {
  const { theme } = useTheme();
  const stripePromise = getStripePromise();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const dialogRef = useOverlayDismiss(onClose);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/enterprise/wallet/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundleCode: bundle.code }),
        });
        const json = (await res.json()) as {
          clientSecret?: string;
          paymentIntentId?: string;
          error?: string;
        };
        if (!alive) return;
        if (!res.ok || !json.clientSecret || !json.paymentIntentId) {
          throw new Error(json.error ?? "Couldn't start checkout.");
        }
        setClientSecret(json.clientSecret);
        setPaymentIntentId(json.paymentIntentId);
      } catch (e) {
        if (alive)
          setFetchError(
            e instanceof Error ? e.message : "Couldn't start checkout."
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [bundle.code]);

  const appearance = useMemo(() => buildStripeAppearance(), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-[var(--z-modal)] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            <Wallet size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="text-[15px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              Buy {bundle.label} — {num(bundle.minutes)} minutes
            </h2>
            <p
              className="mt-1 text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              {eur(bundle.amountCents)} charged once. Minutes are added to your
              company pool immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4">
          {fetchError && (
            <div
              className="rounded-md border px-3 py-2 text-[12px]"
              style={{
                borderColor: "color-mix(in srgb, var(--risk) 30%, transparent)",
                backgroundColor:
                  "color-mix(in srgb, var(--risk) 8%, transparent)",
                color: "var(--risk)",
              }}
            >
              {fetchError}
            </div>
          )}
          {!fetchError && !clientSecret && (
            <div
              className="flex items-center gap-2 py-6 text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              <Loader2 className="size-4 animate-spin" /> Preparing checkout…
            </div>
          )}
          {!fetchError && clientSecret && stripePromise && paymentIntentId && (
            <Elements
              key={theme}
              stripe={stripePromise}
              options={{ clientSecret, appearance }}
            >
              <BuyForm
                bundle={bundle}
                paymentIntentId={paymentIntentId}
                onCancel={onClose}
                onCredited={onCredited}
              />
            </Elements>
          )}
          {!fetchError && clientSecret && !stripePromise && (
            <div
              className="rounded-md border px-3 py-2 text-[12px]"
              style={{
                borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
                backgroundColor:
                  "color-mix(in srgb, var(--warn) 8%, transparent)",
                color: "var(--warn)",
              }}
            >
              Stripe publishable key isn&apos;t configured for this build.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function BuyForm({
  bundle,
  paymentIntentId,
  onCancel,
  onCredited,
}: {
  bundle: Bundle;
  paymentIntentId: string;
  onCancel: () => void;
  onCredited: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setErrMsg(null);
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (error) {
      setErrMsg(error.message ?? "Payment failed.");
      setSubmitting(false);
      return;
    }
    // Payment succeeded (or no redirect needed) — credit the pool server-side.
    try {
      const res = await fetch("/api/enterprise/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok)
        throw new Error(
          json.error ?? "Payment took, but crediting failed — contact support."
        );
      onCredited();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Crediting failed.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PaymentElement
        options={{ layout: { type: "tabs", defaultCollapsed: false } }}
      />
      {errMsg && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: "color-mix(in srgb, var(--risk) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--risk) 8%, transparent)",
            color: "var(--risk)",
          }}
        >
          {errMsg}
        </div>
      )}
      <div className="mt-1 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => void pay()}
          loading={submitting}
          iconLeft={submitting ? undefined : <Check size={14} />}
        >
          {submitting ? "Processing…" : `Pay ${eur(bundle.amountCents)}`}
        </Button>
      </div>
    </div>
  );
}
