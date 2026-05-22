"use client";

/*
 * Button — the only button primitive in the product surface.
 *
 *  Variants:
 *   - primary   : coral CTA (`var(--primary)`). One per screen.
 *   - secondary : surface-raised bg, hairline border. Lower-stakes actions.
 *   - ghost     : transparent bg, hover-tinted. Toolbars, inline.
 *   - danger    : risk-tinted (`var(--risk)`). Destructive confirmations.
 *   - launcher  : green-dot CTA (`var(--green-dot)`). Reserved for the
 *                 launcher dot and the "Get an engineer now" hero on the
 *                 dashboard + the live "Join Zoom call" CTA in-room.
 *                 Carries the `data-relay-pulse` halo by default; pass
 *                 `pulse={false}` to opt out.
 *
 *  Sizes (heights match WCAG 44px touch target at md+):
 *   - sm : h-9   (36px). Use sparingly; not for primary CTAs.
 *   - md : h-11  (44px). Default.
 *   - lg : h-12  (48px).
 *   - xl : h-14  (56px). Hero CTAs only (dashboard).
 *
 *  Loading state shows a tasteful spinner + disables the button. The
 *  visible label is preserved so screen-readers still announce intent.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "launcher";

export type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** Stretch to fill parent width. */
  full?: boolean;
  /** Launcher only: enable the green halo pulse (default true). */
  pulse?: boolean;
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
  lg: "h-12 px-5 text-base gap-2",
  xl: "h-14 px-7 text-lg gap-2.5 rounded-full",
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] active:bg-[var(--primary-hover)] border border-transparent",
  secondary:
    "bg-[var(--surface-raised)] text-[var(--text)] border border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--surface-raised)_82%,var(--text)_18%)] hover:border-[var(--border-strong)]",
  ghost:
    "bg-transparent text-[var(--text)] border border-transparent hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]",
  danger:
    "bg-[var(--risk)] text-white hover:bg-[color-mix(in_srgb,var(--risk)_85%,#000_15%)] border border-transparent",
  launcher:
    "bg-[var(--green-dot)] text-white hover:bg-[var(--primary-hover)] border border-transparent font-semibold shadow-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    iconLeft,
    iconRight,
    full,
    pulse = true,
    className,
    disabled,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const pulseAttr =
    variant === "launcher" && pulse && !isDisabled
      ? { "data-relay-pulse": true }
      : {};

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        // base
        "inline-flex items-center justify-center rounded-full font-medium",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-dot)]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:saturate-50",
        "active:translate-y-px",
        full && "w-full",
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
      {...pulseAttr}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      <span className="inline-flex items-center">{children}</span>
      {!loading && iconRight}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
