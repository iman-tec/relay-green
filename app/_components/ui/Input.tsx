"use client";

/*
 * Input — labeled text input. The label is the SOURCE OF TRUTH for the
 * field's name; placeholder is supplementary text only. This is the
 * direct fix for the "placeholder-only labels everywhere" audit finding.
 *
 *  Required props:
 *   - label   : visible <label>. Pass `srLabel` instead to keep visually
 *               hidden but screen-reader available.
 *   - id      : explicit id; auto-generated if omitted.
 *
 *  Optional:
 *   - hint   : muted helper text below the field.
 *   - error  : error message (sets aria-invalid + replaces hint).
 *   - prefix / suffix : adornments (icons, units).
 *   - size   : "md" (h-11, default) | "lg" (h-12).
 */

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  label?: ReactNode;
  /** Screen-reader-only label; supersedes `label` when both passed. */
  srLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: "md" | "lg";
  /**
   * Show the red asterisk after the label when `required` is true. Default
   * true. Set to false when the field is HTML-required but the label
   * already conveys requirement (e.g. login forms where every field is
   * obviously required and the label hosts other content).
   */
  requiredMark?: boolean;
}

const FIELD_CLASS =
  "w-full bg-[var(--background)] text-[var(--text)] placeholder:text-[var(--text-faint)] " +
  "border border-[var(--border)] rounded-lg px-3.5 outline-none " +
  "focus-visible:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "transition-[border-color,box-shadow] duration-[var(--motion-fast)]";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    srLabel,
    hint,
    error,
    prefix,
    suffix,
    size = "md",
    id: idProp,
    className,
    required,
    requiredMark = true,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  const height = size === "lg" ? "h-12" : "h-11";

  return (
    <div className="flex w-full flex-col gap-1.5">
      {srLabel ? (
        <label htmlFor={id} className="sr-only">
          {srLabel}
        </label>
      ) : label ? (
        <label
          htmlFor={id}
          className="text-sm font-medium text-[var(--text)] flex items-center gap-1"
        >
          {label}
          {required && requiredMark && (
            <span aria-hidden className="text-[var(--risk)]">
              *
            </span>
          )}
        </label>
      ) : null}

      <div
        className={cn(
          "relative flex items-center",
          prefix && "pl-0",
          suffix && "pr-0",
        )}
      >
        {prefix && (
          <span className="pointer-events-none absolute left-3 inline-flex text-[var(--text-muted)]">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            FIELD_CLASS,
            height,
            prefix && "pl-10",
            suffix && "pr-10",
            error &&
              "border-[var(--risk)] focus-visible:border-[var(--risk)] focus-visible:ring-[color-mix(in_srgb,var(--risk)_35%,transparent)]",
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 inline-flex text-[var(--text-muted)]">
            {suffix}
          </span>
        )}
      </div>

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[var(--risk)] leading-snug"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-[var(--text-muted)] leading-snug">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
