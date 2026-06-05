"use client";

/*
 * Lightweight in-tab segmented switch. Used to fold several full sub-views
 * (e.g. Dashboard / Departments / Members) into a single top-level tab
 * without a second row of heavy navigation.
 */

export type Segment<K extends string> = { key: K; label: string };

export function Segmented<K extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "sm",
}: {
  value: K;
  onChange: (k: K) => void;
  options: readonly Segment<K>[];
  ariaLabel?: string;
  /** Pill size. "sm" (default) keeps the existing compact look; "md" is a
   *  slightly larger tab for surfaces that lead with the switch. */
  size?: "sm" | "md";
}) {
  const pillClass =
    size === "md" ? "px-4 py-2 text-[15px]" : "px-3.5 py-1.5 text-sm";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 px-6 pt-5"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={`rounded-full border font-medium transition-colors ${pillClass}`}
            style={{
              borderColor: active ? "var(--primary)" : "var(--border)",
              background: active ? "var(--primary-tint)" : "transparent",
              color: active ? "var(--primary-hover)" : "var(--text-muted)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
