"use client";

/*
 * Lazy client wrapper for ExplainerMotionV6 — mirrors the pattern used by
 * ExplainerVideoLazy. The home page is a server component, so we can't use
 * next/dynamic with `ssr: false` directly from it. This thin island defers
 * downloading the 11-beat scene tree and the audio runtime until after first
 * paint, and reserves layout with a fixed-aspect placeholder to prevent CLS.
 */

import dynamic from "next/dynamic";

const Inner = dynamic(
  () => import("./ExplainerMotionV6").then((m) => m.ExplainerMotionV6),
  {
    ssr: false,
    loading: () => <Skeleton />,
  }
);

function Skeleton() {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        maxHeight: 540,
        borderRadius: 12,
        background:
          "linear-gradient(180deg, rgba(20,20,19,0.6) 0%, rgba(20,20,19,0.85) 100%)",
        border: "1px solid rgba(244,242,238,0.08)",
      }}
    />
  );
}

export function ExplainerMotionV6Lazy() {
  return <Inner />;
}
