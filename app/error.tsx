"use client";

/*
 * App-router error boundary. Catches runtime errors in any page beneath
 * the marketing surface (the file lives at app/error.tsx so it scopes
 * the entire app tree). MUST be a client component — that's the Next.js
 * convention; the server can't recover from the failure that just
 * happened.
 *
 * Kept intentionally calm: no stack trace, no panic copy, no marketing
 * fluff. One headline, one paragraph, two CTAs (Try again + Go home).
 * The "Try again" button calls the reset() prop, which re-renders the
 * failed segment so transient errors (network, race) clear without a
 * full reload.
 *
 * We do NOT auto-redirect — that hides bugs from operators. A real
 * monitoring hook (Sentry / Vercel error reporting) belongs here once
 * the project has one wired up; for now `console.error` is enough to
 * surface in Vercel's runtime logs.
 */

import { useEffect } from "react";
import Link from "next/link";
import { RelayLogo } from "./_marketing/RelayLogo";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    // Vercel surfaces console.error in the runtime log; pair with the
    // `digest` so on-call can grep both the user-visible page and the
    // log lines together.
    console.error("[error-boundary]", error.digest, error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "70dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "clamp(48px, 8vw, 96px) 24px",
        background: "#ffffff",
        fontFamily: "var(--font-inter), -apple-system, system-ui, sans-serif",
        color: "#1d1d1f",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          fontFamily:
            "var(--font-jetbrains), ui-monospace, SFMono-Regular, monospace",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#6e6e73",
          marginBottom: 18,
        }}
      >
        <RelayLogo size={11} trailingGap={10} />
        <span>Something went sideways</span>
      </div>

      <h1
        style={{
          fontFamily:
            "var(--font-source-serif), 'Source Serif 4', Georgia, serif",
          fontWeight: 400,
          fontSize: "clamp(34px, 5vw, 56px)",
          lineHeight: 1.05,
          letterSpacing: "-0.028em",
          margin: "0 0 18px",
          maxWidth: "20ch",
        }}
      >
        We hit a snag rendering this page.
      </h1>

      <p
        style={{
          fontFamily:
            "var(--font-source-serif), 'Source Serif 4', Georgia, serif",
          fontSize: "clamp(16px, 1.3vw, 19px)",
          lineHeight: 1.5,
          color: "#424245",
          maxWidth: "44ch",
          margin: "0 0 28px",
        }}
      >
        It&rsquo;s on us, not you. Try again, or head back to the homepage while
        we look into it.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={reset}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 40,
            padding: "0 18px",
            borderRadius: 999,
            border: "1px solid #111111",
            background: "#111111",
            color: "#ffffff",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 40,
            padding: "0 18px",
            borderRadius: 999,
            border: "1px solid #d2d2d7",
            background: "transparent",
            color: "#1d1d1f",
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Go home &rarr;
        </Link>
      </div>

      {error.digest ? (
        <p
          style={{
            marginTop: 32,
            fontFamily:
              "var(--font-jetbrains), ui-monospace, SFMono-Regular, monospace",
            fontSize: 11,
            color: "#86868b",
            letterSpacing: "0.04em",
          }}
        >
          Reference: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
