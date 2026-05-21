"use client";

/*
 * Toast — minimal inline alert. Direct fix for the audit's
 * "toast errors have no role=alert / aria-live" finding.
 *
 *  This is the *primitive*. A toast stack/provider can be layered on
 *  top later if needed. For now, call-sites render `<Toast>` directly
 *  with controlled visibility (the existing error-banner usage pattern
 *  in RoomClient / EngineerSessionClient / PaywallModal).
 */

import type { ReactNode } from "react";
import { cn } from "./cn";
import type { StatusTone } from "./StatusBadge";

export interface ToastProps {
  tone?: StatusTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Visibly close button slot. Pass an onClose handler to render the X. */
  onClose?: () => void;
  className?: string;
}

const TONE_RING: Record<StatusTone, string> = {
  ok: "border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[var(--ok-soft)]",
  warn: "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[var(--warn-soft)]",
  risk: "border-[color-mix(in_srgb,var(--risk)_45%,transparent)] bg-[var(--risk-soft)]",
  info: "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--primary-soft)]",
  neutral:
    "border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_4%,transparent)]",
};

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
  risk: "text-[var(--risk)]",
  info: "text-[var(--primary)]",
  neutral: "text-[var(--text)]",
};

export function Toast({
  tone = "info",
  title,
  children,
  onClose,
  className,
}: ToastProps) {
  // ok messages are non-critical; everything else is alert-level.
  const liveLevel = tone === "ok" || tone === "neutral" ? "polite" : "assertive";
  return (
    <div
      role={tone === "risk" || tone === "warn" ? "alert" : "status"}
      aria-live={liveLevel}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        "animate-[relay-toast-in_var(--motion-med)_ease-out]",
        TONE_RING[tone],
        className,
      )}
    >
      <div className="flex-1 min-w-0">
        {title && (
          <p className={cn("text-sm font-medium leading-tight", TONE_TEXT[tone])}>
            {title}
          </p>
        )}
        {children && (
          <p className={cn("text-sm leading-snug", title ? "mt-1 text-[var(--text)]" : TONE_TEXT[tone])}>
            {children}
          </p>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="size-8 -mr-1 -mt-1 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-dot)]"
        >
          ×
        </button>
      )}
    </div>
  );
}
