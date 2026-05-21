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
        "flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-[var(--border)]",
        className,
      )}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <h1
          className={cn(
            "text-[var(--text)] tracking-tight leading-tight m-0",
            display ? "font-serif text-3xl" : "font-sans text-2xl font-medium",
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[var(--text-muted)] text-sm leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </header>
  );
}
