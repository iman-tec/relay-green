"use client";

/*
 * IconButton — icon-only button primitive.
 *
 * Use when the visual is a single icon (compose attach, video toggle, mute,
 * close, send). Always require an `aria-label` for screen-reader users —
 * enforced at the type level. Variants mirror Button but rendered as a
 * fixed-aspect square / circle.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Required for a11y — never optional. */
  "aria-label": string;
  loading?: boolean;
  shape?: "circle" | "square";
  children: ReactNode;
}

const SIZE_CLASS: Record<IconButtonSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] border border-transparent shadow-sm",
  secondary:
    "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-raised)] hover:border-[var(--border-strong)]",
  ghost:
    "bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]",
  danger:
    "bg-[var(--risk)] text-white hover:bg-[color-mix(in_srgb,var(--risk)_85%,#000_15%)] border border-transparent",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      variant = "ghost",
      size = "md",
      shape = "circle",
      loading,
      disabled,
      className,
      children,
      type = "button",
      ...rest
    },
    ref
  ) {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center transition-[background-color,border-color,color,box-shadow,transform]",
          "duration-[var(--motion-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]",
          "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
          shape === "circle" ? "rounded-full" : "rounded-xl",
          SIZE_CLASS[size],
          VARIANT_CLASS[variant],
          className
        )}
        {...rest}
      >
        {loading ? (
          <span
            aria-hidden
            className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        ) : (
          children
        )}
      </button>
    );
  }
);
