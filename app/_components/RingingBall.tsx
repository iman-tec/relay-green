"use client";

/*
 * Shared "ringing ball" visual — used by both:
 *   - The customer's MatchingClient (/intake/matching) while waiting for an
 *     engineer to accept.
 *   - The engineer's EngineerIncomingMatch overlay while an offer is
 *     ringing them.
 *
 * Stacks: 3 halo rings + soft under-glow + green ball with heartbeat
 * pulse + phone icon. CSS keyframes (`relay-ringing-ball`,
 * `relay-ringing-icon`, `relay-ringing-halo`) live in app/globals.css.
 *
 * Size knobs are exposed so the engineer card can render a smaller
 * variant when stacked above the buttons.
 */

import { Phone } from "lucide-react";

type Props = {
  /** Outer container size in px (ball + halo area). Default 280. */
  size?: number;
  /** Ball diameter in px. Default 200. */
  ballSize?: number;
  /** Lucide phone icon size. Default 72. */
  iconSize?: number;
};

export function RingingBall({ size = 280, ballSize = 200, iconSize = 72 }: Props) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 3 staggered halo rings (CSS keyframe). */}
      <span className="relay-ringing-halo absolute inset-0 rounded-full" style={{ animationDelay: "0s" }} />
      <span className="relay-ringing-halo absolute inset-0 rounded-full" style={{ animationDelay: "-0.6s" }} />
      <span className="relay-ringing-halo absolute inset-0 rounded-full" style={{ animationDelay: "-1.2s" }} />

      {/* Soft under-glow, blurred, low alpha. */}
      <span
        className="absolute rounded-full"
        style={{
          width: ballSize + 20,
          height: ballSize + 20,
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent) 0%, transparent 70%)",
          filter: "blur(20px)",
        }}
      />

      {/* The ball. Heartbeat pulse from globals.css. */}
      <div
        className="relay-ringing-ball relative flex items-center justify-center rounded-full"
        style={{
          width: ballSize,
          height: ballSize,
          background:
            "radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--primary) 90%, white) 0%, var(--primary) 55%, color-mix(in srgb, var(--primary) 65%, #000) 100%)",
          boxShadow:
            "0 20px 48px color-mix(in srgb, var(--primary) 35%, transparent), " +
            "0 8px 16px color-mix(in srgb, var(--primary) 25%, transparent), " +
            "inset 0 -10px 20px rgba(0, 0, 0, 0.22), " +
            "inset 0 10px 20px rgba(255, 255, 255, 0.14)",
        }}
      >
        <Phone size={iconSize} className="relay-ringing-icon" style={{ color: "#fff" }} strokeWidth={1.6} />
      </div>
    </div>
  );
}
