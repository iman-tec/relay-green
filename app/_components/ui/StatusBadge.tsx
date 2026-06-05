"use client";

/*
 * StatusBadge — semantic status pill. **Icon + label, never color alone.**
 *
 *  Tones:
 *   - ok      : healthy, live, joined  (green-dot)
 *   - warn    : urgent, shaky          (amber `--warn`)
 *   - risk    : critical, at-risk      (red `--risk`)
 *   - info    : ringing, waiting       (coral `--primary`)
 *   - neutral : ended, archived        (muted)
 *
 *  Each tone carries a built-in glyph so color-blind and screen-reader
 *  users get the meaning. Pass `compact` for a dense table row.
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "ok" | "warn" | "risk" | "info" | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-[var(--ok-soft)] text-[var(--ok)] border-[color-mix(in_srgb,var(--ok)_40%,transparent)]",
  warn: "bg-[var(--warn-soft)] text-[var(--warn)] border-[color-mix(in_srgb,var(--warn)_40%,transparent)]",
  risk: "bg-[var(--risk-soft)] text-[var(--risk)] border-[color-mix(in_srgb,var(--risk)_45%,transparent)]",
  info: "bg-[var(--primary-soft)] text-[var(--primary)] border-[color-mix(in_srgb,var(--primary)_40%,transparent)]",
  neutral:
    "bg-[color-mix(in_srgb,var(--text-muted)_12%,transparent)] text-[var(--text-muted)] border-[var(--border)]",
};

const GLYPH: Record<StatusTone, string> = {
  ok: "●",
  warn: "▲",
  risk: "■",
  info: "◆",
  neutral: "○",
};

export interface StatusBadgeProps {
  tone?: StatusTone;
  compact?: boolean;
  /** Override the built-in glyph (e.g. a Lucide icon). */
  icon?: ReactNode;
  /** Whether to apply the slow pulse (only meaningful for `info`/`ok`). */
  pulse?: boolean;
  children: ReactNode;
}

export function StatusBadge({
  tone = "neutral",
  compact = false,
  icon,
  pulse = false,
  children,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border leading-none font-medium whitespace-nowrap",
        compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1 text-xs",
        TONE_CLASS[tone]
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center justify-center",
          compact ? "text-[8px]" : "text-[9px]",
          pulse && "animate-[relay-pulse-ok_1800ms_ease-in-out_infinite]"
        )}
      >
        {icon ?? GLYPH[tone]}
      </span>
      <span>{children}</span>
    </span>
  );
}
