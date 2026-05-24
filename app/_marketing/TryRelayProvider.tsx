"use client";

/*
 * Try-Relay modal state, exposed via React Context.
 *
 * The marketing surface has multiple "Try Relay" entry points (nav, hero,
 * CTA banner) that all need to open the same modal. A Context Provider
 * keeps modal state in one place and lets server-rendered descendants
 * pass through unchanged, only the buttons themselves need to be client
 * components.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { TryRelayFunnel } from "./TryRelayFunnel";

type Ctx = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const TryRelayCtx = createContext<Ctx | null>(null);

export function useTryRelay(): Ctx {
  const ctx = useContext(TryRelayCtx);
  if (!ctx) {
    throw new Error("useTryRelay must be used inside <TryRelayProvider>");
  }
  return ctx;
}

export function TryRelayProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Close on Escape key.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  return (
    <TryRelayCtx.Provider value={{ isOpen, open, close }}>
      {children}
      {isOpen && <TryRelayFunnel onClose={close} />}
    </TryRelayCtx.Provider>
  );
}

