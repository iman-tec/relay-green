"use client";

/*
 * Centered ball + text + "Press the dot →" CTA block used inside the
 * Built-to-Trust section on /product. Replaces the bare ProofDotButton
 * placement: the ball is now horizontally centered in its column,
 * followed by a serif headline, supporting line, and a green pill CTA.
 * The CTA opens the same Try Relay modal as the sphere itself.
 */

import { useTryRelay } from "./TryRelayProvider";
import { ProofDotButton } from "./ProofDotButton";

export function BuiltToTrustCenter() {
  const { open } = useTryRelay();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <ProofDotButton />
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(24px, 2.4vw, 32px)",
          fontWeight: 400,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          margin: "20px 0 12px",
          color: "var(--text-on-dark)",
        }}
      >
        First 10 min,{" "}
        <em style={{ fontStyle: "italic", color: "var(--text-on-dark)" }}>on us</em>.
      </h3>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          lineHeight: 1.6,
          color: "rgba(244, 242, 238, 0.7)",
          margin: "0 auto 24px",
          maxWidth: "44ch",
        }}
      >
        No card. No &ldquo;schedule a call&rdquo;. Press the dot, an engineer
        joins, and you stop being stuck.
      </p>
      <button
        type="button"
        onClick={open}
        className="r-press-dot-cta"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          fontWeight: 600,
          color: "#06090a",
          background: "var(--green)",
          border: "none",
          borderRadius: 999,
          padding: "14px 28px",
          cursor: "pointer",
          letterSpacing: "-0.005em",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          transition:
            "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms ease",
        }}
      >
        Press the dot
        <span aria-hidden="true">&rarr;</span>
      </button>
    </div>
  );
}
