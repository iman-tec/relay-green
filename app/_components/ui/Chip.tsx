"use client";

/*
 * Chip + ChipGroup — selectable / informational chips.
 *
 *  <Chip> is the single primitive (interactive toggle OR static tag).
 *  <ChipGroup> is a controlled selection of chips, single or multi.
 *
 *  Active state uses `--primary-soft` tint + `--primary` border + `--text`
 *  content. Not full coral fill — chips are SELECTIONS, not actions, so
 *  they read "you picked this" without competing with primary CTAs.
 *
 *  Drop-in replacement for `app/_components/wizard/ChipGroup.tsx` — same
 *  prop contract: `options: readonly string[]`, `value: string[]`,
 *  `multi?: boolean`, `onChange: (next: string[]) => void`, `disabled?:
 *  boolean`. Intake step 2 will pass `multi` once the brief's §5.2 fix
 *  is wired.
 */

import { useCallback, type ReactNode } from "react";
import { cn } from "./cn";

export interface ChipProps {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Render as a static badge, not a button (e.g. metadata). */
  static?: boolean;
  /** Selection role inside a group; ignored for static chips. */
  role?: "radio" | "checkbox";
  children: ReactNode;
}

export function Chip({
  active = false,
  disabled = false,
  onClick,
  static: isStatic = false,
  role,
  children,
}: ChipProps) {
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium",
    "border transition-[background-color,border-color,color] duration-[var(--motion-fast)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-dot)]",
    active
      ? "bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--text)]"
      : "bg-transparent border-[var(--border)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]",
    disabled && "opacity-50 cursor-not-allowed",
  );

  if (isStatic) {
    return <span className={cls}>{children}</span>;
  }

  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? active : undefined}
      aria-pressed={!role ? active : undefined}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onClick}
      className={cls}
    >
      {active && (
        <span
          aria-hidden
          className="inline-block size-1.5 rounded-full bg-[var(--primary)]"
        />
      )}
      {children}
    </button>
  );
}

export interface ChipGroupProps {
  options: readonly string[];
  value: string[];
  multi?: boolean;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Optional ARIA label for the group (visually hidden). */
  label?: string;
}

export function ChipGroup({
  options,
  value,
  multi = false,
  onChange,
  disabled = false,
  label,
}: ChipGroupProps) {
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
    [value, multi, onChange, disabled],
  );

  return (
    <div
      role={multi ? "group" : "radiogroup"}
      aria-label={label}
      className="flex flex-wrap gap-2.5"
    >
      {options.map((opt) => (
        <Chip
          key={opt}
          active={value.includes(opt)}
          disabled={disabled}
          role={multi ? "checkbox" : "radio"}
          onClick={() => toggle(opt)}
        >
          {opt}
        </Chip>
      ))}
    </div>
  );
}
