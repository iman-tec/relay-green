/*
 * StatusDot — a dot + word, NOT a filled pill. Reusable across the partner /
 * enterprise / department surfaces. On a screen whose thesis is "fewer boxes,"
 * pills (tiny boxes) undercut it; a dot reads the status without enclosing it.
 *
 *   active  → green (--ok), filled
 *   invited → amber (--warn), filled
 *   paused  → hollow, --text-faint
 *   null    → treated as a plain organic enterprise ("Live")
 */

import type { PartnerStatus } from "./types";

const MAP: Record<
  "active" | "invited" | "paused" | "live",
  { label: string; color: string; hollow?: boolean }
> = {
  active: { label: "Active", color: "var(--ok)" },
  invited: { label: "Invited", color: "var(--warn)" },
  paused: { label: "Paused", color: "var(--text-faint)", hollow: true },
  live: { label: "Live", color: "var(--ok)" },
};

export function StatusDot({ status }: { status: PartnerStatus }) {
  const key = status ?? "live";
  const s = MAP[key];
  return (
    <span
      className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap"
      style={{ color: "var(--text-muted)" }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={
          s.hollow
            ? { border: `1.5px solid ${s.color}` }
            : { background: s.color }
        }
      />
      {s.label}
    </span>
  );
}
