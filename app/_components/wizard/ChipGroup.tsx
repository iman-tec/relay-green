"use client";

import { useCallback } from "react";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.18)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.55)";

export function ChipGroup({
  options,
  value,
  multi = false,
  onChange,
  disabled = false,
}: {
  options: readonly string[];
  value: string[];
  multi?: boolean;
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = useCallback(
    (opt: string) => {
      if (disabled) return;
      const selected = value.includes(opt);
      if (multi) {
        onChange(selected ? value.filter((v) => v !== opt) : [...value, opt]);
      } else {
        onChange(selected ? [] : [opt]);
      }
    },
    [value, multi, onChange, disabled]
  );

  return (
    <div
      className="flex flex-wrap gap-2.5"
      role={multi ? "group" : "radiogroup"}
    >
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={active}
            aria-disabled={disabled}
            onClick={() => toggle(opt)}
            className="rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
            style={{
              border: `1px solid ${active ? BRAND_GREEN_BORDER : "var(--border)"}`,
              background: active ? BRAND_GREEN_SOFT : "transparent",
              color: active ? BRAND_GREEN : "var(--text)",
              opacity: disabled ? 0.5 : 1,
            }}
            disabled={disabled}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
