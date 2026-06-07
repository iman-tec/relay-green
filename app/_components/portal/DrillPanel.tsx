/*
 * DrillPanel — a right-side peek panel for detail-on-demand. Keeps the partner
 * in context (the table stays, dimmed) rather than routing away. Reusable.
 *
 * Renders nothing when closed. Slides in over a scrim; Esc or scrim-click
 * closes; respects prefers-reduced-motion via CSS transition only.
 */

"use client";

import { useEffect } from "react";

export function DrillPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 transition-opacity duration-200"
        style={{
          background: "var(--scrim)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          zIndex: "var(--z-drawer, 50)" as React.CSSProperties["zIndex"],
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 h-full w-[480px] max-w-[92vw] overflow-auto transition-transform duration-200 ease-out"
        style={{
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow:
            "-2px 0 8px rgba(20,23,26,.04), -12px 0 40px rgba(20,23,26,.12)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          zIndex:
            "calc(var(--z-drawer, 50) + 1)" as React.CSSProperties["zIndex"],
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid size-8 place-items-center rounded-lg text-[18px]"
          style={{ color: "var(--text-muted)" }}
        >
          ✕
        </button>
        <div className="p-6">
          <h2
            className="font-serif text-[22px] font-semibold"
            style={{ letterSpacing: "-0.01em" }}
          >
            {title}
          </h2>
          {subtitle && (
            <div
              className="mt-1 font-mono text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              {subtitle}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </div>
      </aside>
    </>
  );
}
