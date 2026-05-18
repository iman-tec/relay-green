"use client";

import { type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";

const BRAND_GREEN = "#3f5c2e";

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
    <div className="min-h-screen w-full flex flex-col items-center px-6 py-10">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <header className="flex items-center justify-between">
          <Wordmark />
          <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Step {step} of {totalSteps}
          </div>
        </header>

        <ProgressBar step={step} total={totalSteps} />

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">{children}</div>

        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={onBack}
            disabled={!onBack || busy}
            className="text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-muted)" }}
          >
            {onBack ? "← Back" : ""}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canAdvance || busy}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-white inline-flex items-center gap-1.5 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: BRAND_GREEN }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {buttonLabel}
            {!busy ? <ChevronRight className="size-4" /> : null}
          </button>
        </div>

        {footer}
      </div>
    </div>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-colors"
          style={{
            background: i < step ? BRAND_GREEN : "var(--border)",
          }}
        />
      ))}
    </div>
  );
}
