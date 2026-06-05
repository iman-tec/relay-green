"use client";

/*
 * Textarea — mirrors Input's label/hint/error contract. Defaults to
 * `rows={3}` and `resize-y`. ChatComposer keeps its own auto-grow textarea;
 * this is for forms (set-password helper text, settings, intake).
 */

import {
  forwardRef,
  useId,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  srLabel?: string;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      srLabel,
      hint,
      error,
      id: idProp,
      className,
      required,
      rows = 3,
      ...rest
    },
    ref
  ) {
    const autoId = useId();
    const id = idProp ?? autoId;
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const describedBy =
      [error ? errorId : null, hint ? hintId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className="flex w-full flex-col gap-1.5">
        {srLabel ? (
          <label htmlFor={id} className="sr-only">
            {srLabel}
          </label>
        ) : label ? (
          <label
            htmlFor={id}
            className="flex items-center gap-1 text-sm font-medium text-[var(--text)]"
          >
            {label}
            {required && (
              <span aria-hidden className="text-[var(--risk)]">
                *
              </span>
            )}
          </label>
        ) : null}

        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full bg-[var(--background)] text-[var(--text)] placeholder:text-[var(--text-faint)]",
            "resize-y rounded-lg border border-[var(--border)] px-3.5 py-2.5 leading-relaxed outline-none",
            "focus-visible:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-[border-color,box-shadow] duration-[var(--motion-fast)]",
            error &&
              "border-[var(--risk)] focus-visible:border-[var(--risk)] focus-visible:ring-[color-mix(in_srgb,var(--risk)_35%,transparent)]",
            className
          )}
          {...rest}
        />

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="text-xs leading-snug text-[var(--risk)]"
          >
            {error}
          </p>
        ) : hint ? (
          <p
            id={hintId}
            className="text-xs leading-snug text-[var(--text-muted)]"
          >
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
