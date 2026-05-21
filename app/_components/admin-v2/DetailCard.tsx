"use client";

/*
 * Detail card for the right-hand main area: title + meta row + optional
 * description + minutes block + action row. Used by enterprise,
 * department, reseller, and pod detail views.
 */

import { MinutesBar } from "./MinutesBar";

export type Badge = {
  label: string;
  /** Optional badge tint hint. */
  tone?: "neutral" | "success" | "warning" | "danger";
};

export function DetailCard({
  title,
  subtitle,
  code,
  badges,
  description,
  minutes,
  rollupCaption,
  actions,
  footerHint,
}: {
  title:    string;
  subtitle?: string;
  /** Mono pill (department_code / enterprise_code / etc). */
  code?:    string;
  badges?:  readonly Badge[];
  description?: string;
  minutes?: { used: number; allocated: number } | null;
  /** e.g. "sum of 4 departments" — displayed under the minutes bar. */
  rollupCaption?: string;
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
  /** Small muted line at the bottom of the card. */
  footerHint?: string;
}) {
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-5"
      style={{
        borderColor: "var(--border)",
        background:  "var(--surface)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-lg font-semibold leading-tight"
            style={{ color: "var(--text)" }}
          >
            {title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {subtitle && (
              <span style={{ color: "var(--text-muted)" }}>{subtitle}</span>
            )}
            {code && (
              <code
                className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                style={{
                  background:  "color-mix(in srgb, var(--text-muted) 12%, transparent)",
                  color:       "var(--text)",
                }}
              >
                {code}
              </code>
            )}
            {(badges ?? []).map((b) => (
              <BadgePill key={b.label} {...b} />
            ))}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {description && (
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}

      {minutes && (
        <div className="flex flex-col gap-2">
          <MinutesBar used={minutes.used} allocated={minutes.allocated} size="md" />
          {rollupCaption && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {rollupCaption}
            </p>
          )}
        </div>
      )}

      {footerHint && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {footerHint}
        </p>
      )}
    </section>
  );
}

function BadgePill({ label, tone = "neutral" }: Badge) {
  const tones: Record<NonNullable<Badge["tone"]>, { fg: string; bg: string }> = {
    neutral: { fg: "var(--text-muted)", bg: "color-mix(in srgb, var(--text-muted) 14%, transparent)" },
    success: { fg: "#3dcb7e",            bg: "color-mix(in srgb, #3dcb7e 14%, transparent)" },
    warning: { fg: "#d4a014",            bg: "color-mix(in srgb, #d4a014 14%, transparent)" },
    danger:  { fg: "var(--primary)",     bg: "color-mix(in srgb, var(--primary) 14%, transparent)" },
  };
  const t = tones[tone];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
      style={{ color: t.fg, background: t.bg }}
    >
      {label}
    </span>
  );
}
