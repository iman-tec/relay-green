"use client";

/*
 * HealthBar — session-health visual for the Supervise board.
 *
 *   score | tone    | label
 *   ──────┼─────────┼─────────────
 *   ≥ 70  | ok      | healthy
 *   40–69 | warn    | shaky
 *   < 40  | risk    | at-risk
 *
 * The label is rendered alongside the bar so meaning is communicated
 * by text, not color alone (fixes the audit's color-only-status finding).
 *
 *   <HealthBar score={62} />
 *
 *  Pass `score={null}` for "no signal yet" (renders a muted dashed bar
 *  with the "no signal" label). Used when there are fewer than two
 *  messages in the session — the AI health score isn't trusted yet
 *  (`MIN_MESSAGES_FOR_AI = 2` from `SuperviseClient`).
 */

import { cn } from "./cn";

export interface HealthBarProps {
  score: number | null;
  /** Hide the textual label (use only in dense tables). */
  hideLabel?: boolean;
  size?: "sm" | "md";
}

function toneFor(score: number | null): "ok" | "warn" | "risk" | "neutral" {
  if (score == null) return "neutral";
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "risk";
}

function labelFor(score: number | null): string {
  if (score == null) return "No signal";
  if (score >= 70) return "Healthy";
  if (score >= 40) return "Shaky";
  return "At risk";
}

const TONE_COLOR: Record<"ok" | "warn" | "risk" | "neutral", string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  risk: "var(--risk)",
  neutral: "var(--text-faint)",
};

const TONE_TEXT: Record<"ok" | "warn" | "risk" | "neutral", string> = {
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
  risk: "text-[var(--risk)]",
  neutral: "text-[var(--text-faint)]",
};

export function HealthBar({
  score,
  hideLabel = false,
  size = "md",
}: HealthBarProps) {
  const tone = toneFor(score);
  const label = labelFor(score);
  const pct = score == null ? 0 : Math.max(2, Math.min(100, score));
  const trackHeight = size === "sm" ? 3 : 5;

  return (
    <div className="flex flex-col gap-1.5">
      {!hideLabel && (
        <div className="flex items-center justify-between text-[11px] leading-none">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-medium",
              TONE_TEXT[tone]
            )}
          >
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full"
              style={{ background: TONE_COLOR[tone] }}
            />
            {label}
          </span>
          {score != null && (
            <span className="text-[var(--text-muted)] tabular-nums">
              {score}
            </span>
          )}
        </div>
      )}
      <div
        className="w-full overflow-hidden rounded-full"
        style={{
          background: "color-mix(in srgb, var(--text-muted) 16%, transparent)",
          height: trackHeight,
        }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score ?? undefined}
        aria-label={`Session health: ${label}`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-[var(--motion-med)]"
          style={{
            width: `${pct}%`,
            background: score == null ? "transparent" : TONE_COLOR[tone],
            borderTop:
              score == null ? `1px dashed ${TONE_COLOR.neutral}` : undefined,
          }}
        />
      </div>
    </div>
  );
}
