"use client";

/*
 * EmptyState — friendly placeholder for "nothing here yet" surfaces.
 *
 *   <EmptyState
 *     icon={<Sparkles />}
 *     title="No projects yet"
 *     body="Start a session and we'll spin one up automatically."
 *     action={<Button>Start a session</Button>}
 *   />
 *
 *  Used by the dashboard empty state, the "No summary yet" panel, the
 *  Inbox empty list, the Supervise board's no-sessions tabs, etc.
 *  Filling the dead-pane problem the audit flagged.
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** Compact = less vertical padding, smaller copy. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center mx-auto",
        compact ? "py-8 max-w-sm gap-3" : "py-14 max-w-md gap-4",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "inline-flex items-center justify-center rounded-full",
            "bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text-muted)]",
            compact ? "size-10" : "size-14",
          )}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <h3
        className={cn(
          "font-serif text-[var(--text)] leading-tight",
          compact ? "text-lg" : "text-2xl",
        )}
      >
        {title}
      </h3>
      {body && (
        <p
          className={cn(
            "text-[var(--text-muted)] leading-relaxed",
            compact ? "text-sm" : "text-[15px]",
          )}
        >
          {body}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
