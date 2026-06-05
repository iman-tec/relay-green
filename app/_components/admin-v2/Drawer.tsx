"use client";

/*
 * Right slide-over drawer used by every Add/Edit form in /admin/v2.
 * Closes on ✕, Esc, scrim click, or after the caller signals success.
 */

import { X } from "lucide-react";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const dialogRef = useOverlayDismiss<HTMLElement>(onClose, open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-drawer)]">
      <div
        className="absolute inset-0 transition-opacity"
        style={{ background: "var(--scrim)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute top-0 right-0 flex h-full flex-col shadow-2xl"
        style={{
          width,
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        <header
          className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: "var(--border)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <footer
            className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: "var(--border)" }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}
