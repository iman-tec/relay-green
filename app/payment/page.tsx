/*
 * /payment, payment summary page.
 *
 * Reads ?plan=<id> from the search params, validates it against the plan
 * registry (app/_marketing/plans.ts), and shows the plan name, detail, and
 * price with a Pay button that creates a Stripe Checkout Session via
 * /api/checkout. Free and quoted plans are intentionally not routed here
 * (the homepage dispatches them elsewhere), but if someone lands here with
 * such an id we render a friendly fallback rather than 404.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getPlan } from "@/app/_marketing/plans";
import { Shell } from "@/app/_marketing/Shell";
import { PayButton } from "./PayButton";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planId } = await searchParams;
  const plan = planId ? getPlan(planId) : null;

  if (!plan) {
    return (
      <Shell>
        <section className="r-section">
          <div className="r-wrap" style={{ maxWidth: 640 }}>
            <h1 className="r-h-1" style={{ marginBottom: 12 }}>
              We could not find that plan.
            </h1>
            <p style={{ marginBottom: 24, color: "var(--ink-soft)" }}>
              Head back to pricing and pick a tier.
            </p>
            <Link href="/#how-we-relay" className="r-btn r-btn-ink">
              Back to pricing <span className="arrow">→</span>
            </Link>
          </div>
        </section>
      </Shell>
    );
  }

  if (plan.kind !== "paid" || plan.amountCents == null) {
    const subtitle =
      plan.kind === "free"
        ? "This one is on us. Book a session instead of paying."
        : "This plan is quoted to your needs. Send us the brief and we will follow up.";
    const ctaHref = plan.kind === "free" ? "/login" : "/#how-we-relay";
    const ctaLabel =
      plan.kind === "free" ? "Book a session" : "Back to pricing";

    return (
      <Shell>
        <section className="r-section">
          <div className="r-wrap" style={{ maxWidth: 640 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-mute)",
                letterSpacing: "0.08em",
                marginBottom: 12,
                textTransform: "uppercase",
              }}
            >
              {plan.phase === "phase1"
                ? "Phase 01"
                : plan.phase === "phase2"
                  ? "Phase 02"
                  : "Phase 03"}
            </div>
            <h1 className="r-h-1" style={{ marginBottom: 12 }}>
              {plan.name}
            </h1>
            <p style={{ marginBottom: 24, color: "var(--ink-soft)" }}>
              {subtitle}
            </p>
            <Link href={ctaHref} className="r-btn r-btn-ink">
              {ctaLabel} <span className="arrow">→</span>
            </Link>
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="r-section">
        <div className="r-wrap" style={{ maxWidth: 640 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--ink-mute)",
              letterSpacing: "0.08em",
              marginBottom: 12,
              textTransform: "uppercase",
            }}
          >
            {plan.phase === "phase1"
              ? "Phase 01"
              : plan.phase === "phase2"
                ? "Phase 02"
                : "Phase 03"}
          </div>
          <h1 className="r-h-1" style={{ marginBottom: 8 }}>
            {plan.name}
          </h1>
          <p
            style={{
              marginBottom: 16,
              color: "var(--ink-soft)",
              fontSize: 16,
            }}
          >
            {plan.detail}
          </p>

          {/*
            SANDBOX_NOTICE. While checkout is sandboxed (see SANDBOX_ONLY in
            app/api/checkout/route.ts), this badge tells anyone landing on
            the payment page that no real money will move. Remove this
            block in the same PR that flips SANDBOX_ONLY to false.
          */}
          <div
            role="status"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              marginBottom: 24,
              borderRadius: 999,
              background: "rgba(212, 154, 38, 0.12)",
              color: "#7a5310",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              border: "1px solid rgba(212, 154, 38, 0.32)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#d49a26",
              }}
            />
            Sandbox · use test card 4242 4242 4242 4242
          </div>

          <div
            style={{
              borderTop: "1px solid var(--rule)",
              borderBottom: "1px solid var(--rule)",
              padding: "20px 0",
              marginBottom: 28,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
              One-time charge
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 500,
                color: "var(--green-deep)",
              }}
            >
              {plan.priceLabel}
            </div>
          </div>

          <PayButton planId={plan.id} />

          <p
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--ink-mute)",
              lineHeight: 1.5,
            }}
          >
            You will be sent to Stripe to complete payment. We do not store
            card details.
          </p>

          <div style={{ marginTop: 32 }}>
            <Link
              href="/#how-we-relay"
              style={{ fontSize: 13, color: "var(--ink-soft)" }}
            >
              ← Back to pricing
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
