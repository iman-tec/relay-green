/*
 * Shared OG card layout for /pricing, /for/[tool], and any future per-page
 * Open Graph image. Centralizes the cream + green-dot brand layout so a
 * one-line change here propagates to every OG and Twitter card on the site.
 *
 * Satori (the renderer behind ImageResponse) only understands flexbox; every
 * element below has display: flex explicitly set. Avoid grid, float, inline.
 *
 * Returns JSX, NOT an ImageResponse — the caller wraps it. That keeps the
 * caller in control of size/contentType per OG vs Twitter aspect ratio.
 */

import type { ReactElement } from "react";

type Variant = "default" | "tool" | "article" | "pricing";

export type OgCardProps = {
  /** Eyebrow text — small uppercase tag above the headline. */
  eyebrow?: string;
  /** Main headline (1-2 lines). Becomes the visual focus of the card. */
  headline: string;
  /** Optional second line under the headline (description / lede). */
  subline?: string;
  /** Optional small tag rendered next to the green dot in the top mark. */
  variant?: Variant;
};

const COLORS = {
  cream: "#f5f4ee",
  ink: "#2c2a26",
  inkSoft: "#6b6862",
  green: "#3dcb7e",
  greenDeep: "#4f6b3a",
} as const;

export function OgCard({
  eyebrow,
  headline,
  subline,
}: OgCardProps): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: COLORS.cream,
        color: COLORS.ink,
        // System UI fallback; the real Inter / Source Serif fonts are
        // loaded via the `fonts` option on the ImageResponse caller.
        fontFamily:
          "Source Serif 4, Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Top row: brand mark + green dot + optional eyebrow */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 22,
          letterSpacing: 2,
          textTransform: "uppercase",
          fontFamily: "Inter, system-ui, sans-serif",
          color: COLORS.inkSoft,
        }}
      >
        <span style={{ color: COLORS.ink, display: "flex" }}>Relay</span>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: COLORS.green,
            display: "flex",
          }}
        />
        {eyebrow ? (
          <span
            style={{
              display: "flex",
              fontSize: 16,
              letterSpacing: 1,
              color: COLORS.inkSoft,
              marginLeft: 8,
            }}
          >
            {eyebrow}
          </span>
        ) : null}
      </div>

      {/* Body: headline + optional subline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          maxWidth: 1000,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: headline.length > 50 ? 76 : 96,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            fontWeight: 500,
            fontFamily: "Source Serif 4, system-ui, serif",
          }}
        >
          {headline}
        </div>
        {subline ? (
          <div
            style={{
              display: "flex",
              fontSize: 26,
              lineHeight: 1.4,
              color: COLORS.inkSoft,
              maxWidth: 880,
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            {subline}
          </div>
        ) : null}
      </div>

      {/* Footer: domain + tagline */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          fontSize: 22,
          color: COLORS.inkSoft,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <span style={{ display: "flex" }}>relay.green</span>
        <span style={{ display: "flex" }}>Human engineers, in seconds.</span>
      </div>
    </div>
  );
}

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";
