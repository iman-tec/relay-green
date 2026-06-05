"use client";

/*
 * Modal — accessible dialog primitive. Replaces the audit-flagged
 * ad-hoc modals (ConfirmEndModal, ConnectingModal, EngineerAssignedModal,
 * MatchingModal, PaywallModal, EngineerIncomingRequest).
 *
 *  - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`/`aria-describedby`.
 *  - ESC closes (via the new `onClose`).
 *  - Backdrop click closes (suppressible with `dismissOnBackdrop={false}`).
 *  - Focus is moved into the dialog on open and restored to the trigger on close.
 *  - Tab is trapped within the dialog while open.
 *  - Body scroll is locked while open.
 *
 *  This is the *new* primitive. Existing modal call-sites will migrate
 *  in their respective phase commits — we don't ship a global rewrite here.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "./cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Footer slot (typically Cancel + Primary button). */
  footer?: ReactNode;
  /** Override default backdrop close behavior. */
  dismissOnBackdrop?: boolean;
  /** Size: sm (max-w-sm) | md (max-w-lg, default) | lg (max-w-2xl) | xl (max-w-4xl). */
  size?: "sm" | "md" | "lg" | "xl";
  children?: ReactNode;
}

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  dismissOnBackdrop = true,
  size = "md",
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the previously-focused element to restore on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Lock body scroll.
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // Move focus into the dialog.
      requestAnimationFrame(() => {
        const focusable =
          dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        focusable?.focus();
      });
      return () => {
        document.body.style.overflow = prev;
        triggerRef.current?.focus?.();
      };
    }
    return undefined;
  }, [open]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const nodes =
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    },
    [open, onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-[relay-fade-in_var(--motion-fast)_ease-out] bg-[var(--scrim)]"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl",
          "flex max-h-[90vh] animate-[relay-toast-in_var(--motion-med)_ease-out] flex-col",
          SIZE[size]
        )}
      >
        {title && (
          <div className="border-b border-[var(--border)] px-6 pt-5 pb-3">
            <h2
              id={titleId}
              className="font-serif text-xl leading-tight text-[var(--text)]"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]"
              >
                {description}
              </p>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
