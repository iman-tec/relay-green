"use client";

/*
 * Client-side lazy wrapper for the 1,440-line <ExplainerVideo />.
 *
 * Why: the home page is a server component, so we can't use next/dynamic
 * with `ssr: false` directly from it. This thin client island lets us:
 *   • hold a fixed-height skeleton placeholder so the section reserves
 *     layout (no CLS as the video animation hydrates and starts);
 *   • defer downloading and instantiating the heavy CSS-animation runtime
 *     and Web Speech API voiceover until after first paint;
 *   • render nothing if the user prefers reduced motion (the section
 *     header above this component still explains what the video would say,
 *     so the skip is graceful).
 */

import dynamic from "next/dynamic";

const ExplainerVideoInner = dynamic(
  () => import("./ExplainerVideo").then((m) => m.ExplainerVideo),
  {
    ssr: false,
    loading: () => <ExplainerVideoSkeleton />,
  }
);

function ExplainerVideoSkeleton() {
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
          "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    />
  );
}

export function ExplainerVideoLazy() {
  return <ExplainerVideoInner />;
}
