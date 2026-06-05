"use client";

/*
 * MinutesBar — a thin progress bar showing `used / allocated` with the
 * color rules from the spec:
 *   • < 70%  → muted neutral
 *   • 70–90% → amber warning
 *   • ≥ 90%  → coral primary
 *   • ≥ 100% → solid coral + small "over" badge
 */

const AMBER = "#d4a014";
const CORAL = "var(--primary)";
const MUTED = "var(--text-muted)";

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  // Cap at 2 decimal places so fractional minute counts (e.g. 2.34444…)
  // render as "2.34" instead of bleeding into the layout.
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function MinutesBar({
  used,
  allocated,
  size = "md",
  showLabel = true,
}: {
  used: number;
  allocated: number;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const ratio = allocated > 0 ? used / allocated : 0;
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const over = ratio > 1;

  const fill = over
    ? CORAL
    : ratio >= 0.9
      ? CORAL
      : ratio >= 0.7
        ? AMBER
        : MUTED;

  const trackHeight = size === "sm" ? 4 : 6;
  const labelSize = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <div className="flex flex-col gap-1">
      {showLabel && (
        <div className={`flex items-center justify-between gap-2 ${labelSize}`}>
          <span style={{ color: "var(--text)" }}>
            {size === "sm"
              ? `${compact(used)}/${compact(allocated)} min`
              : `${used.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })} min`}
          </span>
          <span
            className="flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            {pct}%
            {over && (
              <span
                className="rounded px-1.5 py-px text-[10px] font-semibold tracking-wider uppercase"
                style={{ background: CORAL, color: "#fff" }}
              >
                over
              </span>
            )}
          </span>
        </div>
      )}
      <div
        className="w-full overflow-hidden rounded-full"
        style={{
          background: "color-mix(in srgb, var(--text-muted) 18%, transparent)",
          height: trackHeight,
        }}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: fill }}
        />
      </div>
    </div>
  );
}
