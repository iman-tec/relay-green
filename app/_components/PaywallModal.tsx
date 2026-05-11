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

import { useState } from "react";
import { Loader2, X, ArrowRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { SUPPORT_PLANS, LAUNCH_PLANS, RETAINER, type SupportPlanCode } from "@/lib/relay/pricing";

const BRAND_GREEN = "#5d8a44";        // brighter on dark
const SURFACE     = "#0a0a0a";        // modal body
const CARD        = "#141413";        // card body
const CARD_EDGE   = "#2a2a28";        // dividers / borders
const INK         = "#f5f2ec";        // primary text on dark
const INK_SOFT    = "#c7c5bd";        // body text
const INK_MUTE    = "#7c7a73";        // footnotes
const BACKDROP    = "rgba(0, 0, 0, 0.78)";

export function PaywallModal({
  open, reason, onClose,
}: {
  open: boolean;
  reason: "free_expired" | "no_credits" | "manual";
  onClose: () => void;
}) {
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (e || !data?.url) {
        setError(e?.message ?? data?.error ?? "Could not start checkout");
        return;
      }
      window.location.href = data.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusyPlan(null);
    }
  };

  if (!open) return null;

  const eyebrow =
    reason === "free_expired" ? "Your free 10 minutes are up"
    : reason === "no_credits" ? "Pick a plan to continue"
    : "Three phases. One team.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ backgroundColor: BACKDROP, backdropFilter: "blur(6px)" }}
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
          <div className="mb-6 text-center">
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
              Three phases. One team.{" "}
              <span style={{ fontStyle: "italic", color: INK_SOFT }}>Same engineer the whole way.</span>
            </h1>
          </div>

          {error && (
            <div
              className="mx-auto mb-4 max-w-md rounded-md border px-3 py-2 text-center text-xs"
              style={{
                borderColor: "rgba(200, 85, 61, 0.4)",
                backgroundColor: "rgba(200, 85, 61, 0.12)",
                color: "#e88670",
              }}
            >
              {error}
            </div>
          )}

          {/* Three cards */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* ── Phase 01 ── */}
            <PhaseCard
              tag="Phase 01"
              title="Build Phase"
              tagline="You build. We support."
              description="On-demand sessions while your AI takes a build from concept to MVP."
              footnotes={[
                "Each session is 10 min",
                "Each plan is valid for 12 months",
              ]}
              cta={{
                label: "Get in touch",
                onClick: () => {
                  window.location.href = "mailto:support@relay.green?subject=Phase%2001%20—%20Custom%20support%20plan";
                },
              }}
            >
              {SUPPORT_PLANS.map((p) => {
                const isPaid = p.purchasable;
                const busy = busyPlan === p.code;
                return (
                  <PlanRow
                    key={p.code}
                    name={p.name + (p.code === "free" ? "" : " plan")}
                    sub={p.minutes ? `${p.minutes} min ${p.code === "free" ? "on us" : "of support"}` : ""}
                    price={p.cta}
                    interactive={isPaid}
                    busy={busy}
                    onClick={isPaid ? () => void checkout(p.code as SupportPlanCode) : undefined}
                  />
                );
              })}
            </PhaseCard>

            {/* ── Phase 02 ── */}
            <PhaseCard
              tag="Phase 02"
              title="Launch and Go-Live"
              tagline="You tell us when. We quote on complexity."
              description="A Relay engineer takes the wheel through launch — fixed scope, fixed price, calendar promise."
              footnotes={["Customized quote available for specific cases"]}
              cta={{
                label: "Get in touch",
                onClick: () => {
                  window.location.href = "mailto:support@relay.green?subject=Phase%2002%20—%20Launch%20project";
                },
              }}
            >
              {LAUNCH_PLANS.map((p) => (
                <PlanRow key={p.code} name={p.name} sub={p.blurb} price={p.priceLabel} />
              ))}
            </PhaseCard>

            {/* ── Phase 03 ── */}
            <PhaseCard
              tag="Phase 03"
              title="Maintain and Scale"
              tagline="We take accountability. You focus on your business."
              description="Monthly retainer. Same team that launched you keeps it shipping, secure, and current."
              footnotes={["Customized quote available for specific cases"]}
              cta={{
                label: "Get in touch",
                onClick: () => {
                  window.location.href = "mailto:support@relay.green?subject=Phase%2003%20—%20Monthly%20retainer";
                },
              }}
            >
              <PlanRow name={RETAINER.name} sub={RETAINER.blurb} price={RETAINER.priceLabel} />
            </PhaseCard>
          </div>

          {/* Hint */}
          <p className="mt-4 text-center text-[10px]" style={{ color: INK_MUTE }}>
            Tap a Build-phase plan to check out with Stripe · Test card{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: INK_SOFT }}>4242 4242 4242 4242</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Phase card shell ───────────────────────────────────────────────────────
function PhaseCard({
  tag, title, tagline, description, footnotes, cta, children,
}: {
  tag: string;
  title: string;
  tagline: string;
  description: string;
  footnotes: string[];
  cta: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col rounded-xl border p-5"
      style={{ borderColor: CARD_EDGE, backgroundColor: CARD }}
    >
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK_MUTE }}>
        {tag}
      </div>
      <h2
        className="text-lg font-medium tracking-tight"
        style={{ fontFamily: "var(--font-source-serif)", color: INK, letterSpacing: "-0.01em" }}
      >
        {title}
      </h2>
      <p className="mt-1 text-[12px] font-medium" style={{ color: INK }}>
        {tagline}
      </p>
      <p className="mt-1.5 text-[12px] leading-snug" style={{ color: INK_SOFT }}>
        {description}
      </p>

      <div className="my-3 flex flex-col gap-0" style={{ borderTop: `1px solid ${CARD_EDGE}` }}>
        {children}
      </div>

      <div className="mt-auto">
        {footnotes.map((f, i) => (
          <p key={i} className="mt-0.5 text-[10px]" style={{ color: INK_MUTE }}>
            ∗ {f}
          </p>
        ))}
        <button
          onClick={cta.onClick}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2 text-[12px] font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {cta.label}
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Plan row ───────────────────────────────────────────────────────────────
function PlanRow({
  name, sub, price, interactive = false, busy = false, onClick,
}: {
  name: string;
  sub: string;
  price: string;
  interactive?: boolean;
  busy?: boolean;
  onClick?: () => void;
}) {
  const isClickable = interactive && !!onClick && !busy;
  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      className="group flex w-full items-start justify-between gap-3 py-2.5 text-left transition-colors"
      style={{
        borderBottom: `1px solid ${CARD_EDGE}`,
        cursor: isClickable ? "pointer" : "default",
      }}
    >
      <div>
        <div className="text-[13px] font-medium" style={{ color: INK }}>
          {name}
        </div>
        {sub && (
          <div className="mt-0.5 text-[10px]" style={{ color: INK_MUTE }}>
            {sub}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {isClickable && (
          <span
            className="opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: BRAND_GREEN }}
            aria-hidden
          >
            <Check size={12} />
          </span>
        )}
        <span
          className="text-[13px] font-medium tabular-nums"
          style={{
            color: interactive ? BRAND_GREEN : INK,
            fontFamily: interactive ? "var(--font-mono)" : "var(--font-source-serif)",
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin inline" /> : price}
        </span>
      </div>
    </button>
  );
}
