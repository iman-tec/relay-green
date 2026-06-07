"use client";

/*
 * Modal — a centered command-center dialog for in-console mutations (create
 * department, invite member, refill). Scrim + card + title; Esc / scrim-click
 * closes. Renders null when closed. Shared across the v2 consoles.
 */

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full rounded-2xl border p-6 shadow-xl"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          maxWidth,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="text-[17px] font-semibold"
            style={{ color: "var(--text)" }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-[18px]"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Labeled text input for modal forms. */
export function ModalField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 flex flex-col gap-1.5">
      <span
        className="text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export const modalInputClass =
  "w-full rounded-md border px-3 py-2.5 text-[15px] outline-none";
export const modalInputStyle = {
  borderColor: "var(--border-strong)",
  background: "var(--surface)",
} as const;
