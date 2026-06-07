/*
 * KpiRibbon — four numbers on ONE line, separated by space, not boxes. The
 * fix for "too many cards": metrics are reference, so they sit quiet; exactly
 * one item is the `anchor` and carries the single green underline + an optional
 * sub-line. Reusable for enterprise/department later.
 *
 * Values are pre-formatted strings (the caller owns money/number formatting).
 */

export type Kpi = {
  label: string;
  value: string;
  /** quiet second line — e.g. lifetime under a monthly figure */
  sub?: string;
  /** the one anchored metric: green underline + click target */
  anchor?: boolean;
  onClick?: () => void;
};

export function KpiRibbon({ items }: { items: Kpi[] }) {
  return (
    <div className="flex flex-wrap gap-x-14 gap-y-6 pb-1">
      {items.map((k) => {
        const Tag = k.onClick ? "button" : "div";
        return (
          <Tag
            key={k.label}
            type={k.onClick ? "button" : undefined}
            onClick={k.onClick}
            className={`group/kpi text-left ${k.onClick ? "cursor-pointer" : ""}`}
          >
            <div
              className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              {k.label}
            </div>
            <div
              className="font-mono text-[28px] leading-none font-medium tabular-nums"
              style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
            >
              <span
                className="inline-block pb-1.5"
                style={
                  k.anchor
                    ? { boxShadow: "inset 0 -2px 0 0 var(--primary)" }
                    : undefined
                }
              >
                {k.value}
              </span>
            </div>
            {k.sub && (
              <div
                className="mt-1 text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                {k.sub}
              </div>
            )}
          </Tag>
        );
      })}
    </div>
  );
}
