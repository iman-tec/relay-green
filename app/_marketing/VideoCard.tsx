"use client";

import { useState } from "react";

type Props = {
  src: string;
  poster?: string;
  eyebrow: string;
  duration: string;
  description: string;
  testId?: string;
};

/*
 * Poster-style video card used in the "See Relay in action" 2-up.
 *
 * Idle state: dark card with a green radial glow in the top-right, a
 * filled green play button in that corner, and metadata (eyebrow · duration
 * + large display headline) in the bottom-left.
 *
 * On click: swaps to a native <video controls autoPlay>. Once playing, the
 * card is the standard player — keyboard, fullscreen, captions all native.
 *
 * The wrapper is a <button> so the entire card is one keyboard-focusable
 * play target; aria-label combines eyebrow + description for screen readers.
 */
export function VideoCard({
  src,
  poster,
  eyebrow,
  duration,
  description,
  testId,
}: Props) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <video
        src={src}
        poster={poster}
        controls
        autoPlay
        playsInline
        preload="metadata"
        data-testid={testId}
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 16,
          border: "1px solid rgba(48, 197, 109, 0.18)",
          display: "block",
          background: "#06090a",
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      data-testid={testId}
      aria-label={`Play ${eyebrow.toLowerCase()}: ${description}`}
      className="mk-video-card"
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: 16,
        border: "1px solid rgba(48, 197, 109, 0.18)",
        background:
          "radial-gradient(ellipse at top right, rgba(48, 197, 109, 0.22) 0%, rgba(48, 197, 109, 0.06) 35%, rgba(6, 9, 10, 0) 65%), #06090a",
        cursor: "pointer",
        overflow: "hidden",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        textAlign: "left",
        fontFamily: "inherit",
        color: "var(--text-on-dark)",
        transition:
          "transform 250ms cubic-bezier(0.22, 1, 0.36, 1), border-color 250ms ease, box-shadow 250ms ease",
      }}
    >
      {/* Play button — top right, glowing */}
      <span
        aria-hidden
        className="mk-video-play"
        style={{
          alignSelf: "flex-end",
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--green)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            "0 0 28px rgba(48, 197, 109, 0.55), 0 0 60px rgba(48, 197, 109, 0.28)",
          transition: "transform 250ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden>
          <path d="M2 1.5L18 11L2 20.5V1.5Z" fill="#06090a" />
        </svg>
      </span>

      {/* Metadata — bottom left */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--green)",
            fontWeight: 500,
          }}
        >
          {eyebrow} · {duration}
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(18px, 2vw, 22px)",
            lineHeight: 1.3,
            fontWeight: 500,
            color: "var(--text-on-dark)",
            maxWidth: "34ch",
            letterSpacing: "-0.005em",
          }}
        >
          {description}
        </span>
      </div>
    </button>
  );
}
