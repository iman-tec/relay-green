/*
 * StatusDot — a dot + word, NOT a filled pill. Shared across the partner /
 * enterprise / department command centers. On a screen whose thesis is "fewer
 * boxes," pills (tiny boxes) undercut it; a dot reads the status without
 * enclosing it.
 *
 *   active    → green (--ok), filled
 *   invited   → amber (--warn), filled
 *   paused    → hollow, --text-faint
 *   suspended → hollow, --risk
 *   live      → green (the null/organic case)
 */

export type PortalStatus =
  | "active"
  | "invited"
  | "paused"
  | "suspended"
  | "live"
  | null
  | undefined;

const MAP: Record<
  "active" | "invited" | "paused" | "suspended" | "live",
  { label: string; color: string; hollow?: boolean }
> = {
  active: { label: "Active", color: "var(--ok)" },
  invited: { label: "Invited", color: "var(--warn)" },
  paused: { label: "Paused", color: "var(--text-faint)", hollow: true },
  suspended: { label: "Suspended", color: "var(--risk)", hollow: true },
  live: { label: "Live", color: "var(--ok)" },
};

export function StatusDot({
  status,
  label,
}: {
  status: PortalStatus;
  /** Override the default word (e.g. show "Active" for a non-partner org). */
  label?: string;
}) {
  const s = MAP[status ?? "live"];
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
      {label ?? s.label}
    </span>
  );
}
