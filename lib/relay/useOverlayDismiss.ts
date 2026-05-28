"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Overlay accessibility for hand-rolled modals that don't (yet) use the
 * `ui/Modal` primitive. Attach the returned ref to the dialog element. While
 * the component is mounted it:
 *   - locks body scroll,
 *   - moves focus into the dialog and restores it to the trigger on unmount,
 *   - traps Tab within the dialog,
 *   - closes on Esc (top layer only — `stopPropagation` prevents a parent
 *     overlay from also closing).
 *
 * For components mounted *while open* (e.g. `{open && <Modal/>}`) the default
 * `active=true` is fine. For always-mounted components that toggle via an
 * `open` prop, pass that prop as `active` so the lock/trap only engage while open.
 */
export function useOverlayDismiss<T extends HTMLElement = HTMLDivElement>(onClose: () => void, active = true) {
  const ref = useRef<T>(null);
  // Stabilise the onClose callback. Callers commonly pass inline closures
  // (e.g. `onClose={() => { reset(); close(); }}`); without this ref
  // indirection the effect's deps see a new identity on every parent
  // re-render → cleanup fires → `prevFocus?.focus?.()` snaps focus back
  // to whatever was active when the effect originally ran, which is the
  // dialog's first focusable element (the ✕ Close button). Bug symptom:
  // typing one character in any field steals focus to Close.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!active) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && ref.current) {
        const nodes = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE);
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
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.();
    };
  }, [active]);
  return ref;
}
