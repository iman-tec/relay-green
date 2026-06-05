"use client";

/*
 * Card — composable container.
 *
 *   <Card>
 *     <CardHeader>…</CardHeader>
 *     <CardBody>…</CardBody>
 *     <CardFooter>…</CardFooter>
 *   </Card>
 *
 *  Variants:
 *   - surface (default) : `--surface` bg
 *   - raised            : `--surface-raised` bg (cards layered on `surface`)
 *   - hollow            : transparent + border only (empty-state framing)
 *
 *  Set `interactive` to add hover lift + pointer cursor (e.g. session
 *  cards on the Supervise board that are clickable).
 */

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CardVariant = "surface" | "raised" | "hollow";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  interactive?: boolean;
  children: ReactNode;
}

const VARIANT: Record<CardVariant, string> = {
  surface: "bg-[var(--surface)] border border-[var(--border)] shadow-sm",
  raised: "bg-[var(--surface-raised)] border border-[var(--border)]",
  hollow: "bg-transparent border border-[var(--border)]",
};

export function Card({
  variant = "surface",
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl",
        VARIANT[variant],
        interactive &&
          "cursor-pointer transition-[transform,border-color,background-color] duration-[var(--motion-fast)] hover:-translate-y-px hover:border-[var(--border-strong)]",
        className
      )}
      data-hover-lift={interactive || undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 py-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
