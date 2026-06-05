"use client";

/*
 * SectionHeader — title + optional subtitle + right-slot for actions.
 * Used at the top of pages and large sub-sections.
 *
 *   <SectionHeader
 *     title="Pod GATEWAY-ANGULAR"
 *     subtitle="Engineers under your watch"
 *     right={<Button variant="ghost">Refresh</Button>}
 *   />
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  /** Use the serif display face for the title (default true). */
  display?: boolean;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  right,
  display = true,
  className,
}: SectionHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-4",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1
          className={cn(
            "m-0 leading-tight tracking-tight text-[var(--text)]",
            display ? "font-serif text-3xl" : "font-sans text-2xl font-medium"
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}
