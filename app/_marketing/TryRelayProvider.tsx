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
      {isOpen && <TryRelayModal />}
    </TryRelayCtx.Provider>
  );
}

function TryRelayModal() {
  const { close } = useTryRelay();

  return (
    <div
      className="mk-root-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tryrelay-title"
      onClick={close}
    >
      <div className="mk-root-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="mk-root-modal-close"
          aria-label="Close"
          onClick={close}
        >
          ×
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#4f6b3a",
              display: "inline-block",
            }}
          ></span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#8c8a82",
            }}
          >
            relay.green console
          </span>
        </div>
        <h2 id="tryrelay-title">The console opens here.</h2>
        <p className="body">
          Once you click <em style={{ color: "#3f5c2e" }}>Try Relay</em>, the
          Relay desktop opens, same way Claude.ai opens behind{" "}
          <em style={{ color: "#3f5c2e" }}>Try Claude</em>. The green dot lives
          top-right; press it any time you want a software engineer in the loop.
        </p>
        <div className="console-card">
          <div className="url">→ relay.green/console</div>
          <div className="meta">
            Currently in private beta. Public launch Q3 2026.
          </div>
        </div>
        <form
          className="mk-root-modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <label htmlFor="tryrelay-email" className="sr-only">
            Email address
          </label>
          <input
            id="tryrelay-email"
            type="email"
            required
            placeholder="you@company.com"
            className="mk-root-modal-input"
          />
          <button type="submit" className="r-btn r-btn-green">
            Join the waitlist
          </button>
        </form>
      </div>
    </div>
  );
}
