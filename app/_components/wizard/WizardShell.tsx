"use client";

/*
 * Full-screen wizard shell (intake).
 *
 * Two-pane layout on desktop, single column on mobile.
 *
 *   ┌──────────────────┬──────────────────────────────┐
 *   │                  │                              │
 *   │   Editorial      │   Question + chip-grid      │
 *   │   left panel     │   + back / next             │
 *   │                  │                              │
 *   └──────────────────┴──────────────────────────────┘
 *
 * On <lg the editorial panel collapses to a slim header so the form fills
 * the viewport — important for the wizard to feel uncramped on phones.
 *
 * Phase-4 restyle: calm control-room aesthetic. Left panel uses
 * `--surface-raised` + a quiet coral atmosphere instead of the flat solid
 * green. Coral primary CTA via ui/Button. Hairline progress bar.
 * Editorial serif headlines.
 */

import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { Button } from "@/app/_components/ui";

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
  step: number; // 1-indexed
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
    <div className="min-h-[100dvh] w-full grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ── Editorial left panel ─────────────────────────────────────── */}
      <aside
        className="relative flex flex-col justify-between overflow-hidden bg-[var(--surface-raised)] text-[var(--text)] px-8 py-8 lg:px-12 lg:py-12"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-96"
          style={{
            background:
              "radial-gradient(ellipse at top left, color-mix(in srgb, var(--primary) 14%, transparent), transparent 65%)",
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-0 size-72 rounded-full opacity-15 blur-3xl"
          style={{ background: "var(--green-dot)" }}
        />

        <header className="relative flex items-center justify-between">
          <Wordmark />
          <span className="hidden text-xs font-medium tracking-wide text-[var(--text-muted)] lg:inline">
            Step {step} of {totalSteps}
          </span>
        </header>

        <div className="relative mt-10 hidden flex-1 flex-col justify-center lg:flex">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
            Step {step} of {totalSteps}
          </p>
          <h1 className="mt-3 font-serif text-4xl font-medium leading-tight tracking-tight text-[var(--text)]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
              {subtitle}
            </p>
          )}
        </div>

        <ProgressBar step={step} totalSteps={totalSteps} />
      </aside>

      {/* ── Form pane ────────────────────────────────────────────────── */}
      <section className="flex flex-col bg-[var(--background)] px-6 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-14">
        {/* Mobile-only repeat of the question heading. */}
        <div className="mb-8 lg:hidden">
          <h2 className="font-serif text-2xl font-medium tracking-tight text-[var(--text)]">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-2 text-sm text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>

        <div className="flex flex-1 flex-col justify-center max-w-3xl">
          <div className="flex flex-col gap-6">{children}</div>
        </div>

        <div className="mt-12 flex max-w-3xl items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            disabled={!onBack || busy}
            className="text-sm font-medium text-[var(--text-muted)] transition-opacity hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {onBack ? "← Back" : ""}
          </button>
          <Button
            type="button"
            onClick={onNext}
            disabled={!canAdvance}
            loading={busy}
            size="lg"
            iconRight={!busy ? <ChevronRight className="size-4" /> : null}
          >
            {buttonLabel}
          </Button>
        </div>

        {footer && <div className="mt-4 max-w-3xl">{footer}</div>}
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
                ? "var(--text)"
                : current
                  ? "color-mix(in srgb, var(--text) 65%, transparent)"
                  : "color-mix(in srgb, var(--text) 14%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}
