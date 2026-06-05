"use client";

/*
 * Back-navigation breadcrumb used by the /admin/v2 tabs.
 *
 * Caller supplies a list of segments; the last one renders as plain text
 * (the current view), the rest as muted buttons that pop the selection
 * one level deeper. Clicking the root crumb resets to the top.
 */

import { ChevronRight } from "lucide-react";

export type Crumb = {
  label: string;
  /** Omit on the deepest crumb to render it as plain text. */
  onClick?: () => void;
};

export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav
      className="mb-5 flex flex-wrap items-center gap-1.5 text-xs"
      style={{ color: "var(--text-muted)" }}
      aria-label="Breadcrumb"
    >
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3" />}
            {c.onClick && !isLast ? (
              <button
                type="button"
                onClick={c.onClick}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                {c.label}
              </button>
            ) : (
              <span className="px-1.5 py-0.5" style={{ color: "var(--text)" }}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
