"use client";

/*
 * Full-screen wizard shell (bugs2.txt #6).
 *
 * Two-pane layout on desktop, single column on mobile.
 *
 *   ┌──────────────────┬──────────────────────────────┐
 *   │                  │                              │
 *   │   Brand panel    │  Question + chip-grid +     │
 *   │   • Wordmark     │  back / next                │
 *   │   • Big title    │                              │
 *   │   • Subtitle     │                              │
 *   │   • Step dots    │                              │
 *   │                  │                              │
 *   └──────────────────┴──────────────────────────────┘
 *
 * On <lg the brand panel collapses to a slim header so the form fills the
 * viewport — important for the wizard to feel uncramped on phones.
 *
 * The eyebrow / heading content on the left is interpolated from the
 * current step's title + subtitle so the layout doesn't need a separate
 * "leftContent" prop. The right side renders the actual chip groups.
 */

import { type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";

const BRAND_GREEN        = "#3f5c2e";
const BRAND_GREEN_DARK   = "#2a3d1f";

export function WizardShell({
  title,
  subtitle,
  step,
  totalSteps,
  canAdvance,
  isLast = false,
  busy = false,
  nextLabel,
  onNext,
  onBack,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  step: number;        // 1-indexed
  totalSteps: number;
  canAdvance: boolean;
  isLast?: boolean;
  busy?: boolean;
  nextLabel?: string;
  onNext: () => void;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const buttonLabel = nextLabel ?? (isLast ? "Finish" : "Next");

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ── Brand panel (full-screen lg, slim header below lg) ─────────── */}
      <aside
        className="relative flex flex-col justify-between overflow-hidden px-8 py-8 lg:px-12 lg:py-12"
        style={{
          background: `linear-gradient(135deg, ${BRAND_GREEN_DARK} 0%, ${BRAND_GREEN} 100%)`,
          color: "#f5f4ee",
        }}
      >
        {/* Decorative glow blobs — pure cosmetic, no semantics */}
        <span
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "#7fa05e" }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-0 size-72 rounded-full opacity-20 blur-3xl"
          style={{ background: "#d97757" }}
        />

        <header className="relative flex items-center justify-between">
          <Wordmark />
          <span className="hidden text-xs font-medium tracking-wide opacity-70 lg:inline">
            Step {step} of {totalSteps}
          </span>
        </header>

        <div className="relative mt-10 hidden flex-1 flex-col justify-center lg:flex">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
            Step {step} of {totalSteps}
          </p>
          <h1 className="mt-3 text-4xl font-serif font-medium leading-tight tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-4 max-w-md text-base leading-relaxed opacity-80">
              {subtitle}
            </p>
          ) : null}
        </div>

        <ProgressBar step={step} totalSteps={totalSteps} />
      </aside>

      {/* ── Form pane ──────────────────────────────────────────────────── */}
      <section
        className="flex flex-col px-6 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-14"
        style={{ background: "var(--background)" }}
      >
        {/* Mobile-only repeat of the question heading (the left panel hides
            on small viewports). */}
        <div className="mb-8 lg:hidden">
          <h2 className="text-2xl font-serif font-medium tracking-tight">{title}</h2>
          {subtitle ? (
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-3xl">
          <div className="flex flex-col gap-6">{children}</div>
        </div>

        <div className="mt-12 flex items-center justify-between gap-4 max-w-3xl">
          <button
            type="button"
            onClick={onBack}
            disabled={!onBack || busy}
            className="text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            style={{ color: "var(--text-muted)" }}
          >
            {onBack ? "← Back" : ""}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canAdvance || busy}
            className="rounded-full px-7 py-3 text-sm font-semibold text-white inline-flex items-center gap-1.5 transition-all disabled:cursor-not-allowed disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: BRAND_GREEN, boxShadow: `0 10px 25px -8px ${BRAND_GREEN}` }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {buttonLabel}
            {!busy ? <ChevronRight className="size-4" /> : null}
          </button>
        </div>

        {footer ? <div className="mt-4 max-w-3xl">{footer}</div> : null}
      </section>
    </div>
  );
}

function ProgressBar({ step, totalSteps }: { step: number; totalSteps: number }) {
  return (
    <div className="relative mt-8 flex gap-2">
      {Array.from({ length: totalSteps }).map((_, i) => {
        const done = i < step - 1;
        const current = i === step - 1;
        return (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full transition-all duration-300"
            style={{
              background: done
                ? "#f5f4ee"
                : current
                  ? "rgba(245, 244, 238, 0.7)"
                  : "rgba(245, 244, 238, 0.18)",
            }}
          />
        );
      })}
    </div>
  );
}
