/*
 * Single source of truth for the Relay wordmark + green dot lockup.
 *
 * Canonical look: uppercase RELAY in the brand sans (Inter / system),
 * weight 500, 0.04em letter-spacing, immediately followed by the
 * animated green dot (r-mark-dot, 0.7em diameter, brand green, pulse
 * halo). No serifs, ever, even when the surrounding type is editorial
 * serif (e.g. inside an h1 set in Source Serif 4) or on a dark band.
 *
 * Every place the brand mark appears, nav, footer, hero eyebrow,
 * about sigil card, product / for-enterprise trust band, explainer
 * header, should use this component so a future typography change
 * never breaks the logo by inheritance.
 *
 * Props:
 *   size       , pixel or string CSS size for the wordmark. Default 14.
 *                 The dot is 0.7em (CSS default), so it scales with size.
 *   color      , wordmark color. Default `currentColor` so dark / light
 *                 surfaces inherit naturally.
 *   trailingGap, optional `marginRight` to add spacing AFTER the lockup
 *                 when followed by more text in the same run (e.g.
 *                 ", On the record"). The dot itself stays flush
 *                 against the wordmark.
 */

import type { CSSProperties } from "react";

type Props = {
  size?: number | string;
  color?: string;
  trailingGap?: number | string;
  /** Pass-through for layout tweaks (e.g. marginBottom on a stacked
   * eyebrow). Avoid overriding font-family / font-style here, the
   * point of this component is to lock those down. */
  style?: Omit<CSSProperties, "fontFamily" | "fontStyle" | "fontWeight">;
};

export function RelayLogo({
  size = 14,
  color = "currentColor",
  trailingGap,
  style,
}: Props) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        // Lock the wordmark to the brand sans no matter what the
        // surrounding type is doing. This is the whole reason this
        // component exists.
        fontFamily: "var(--font-sans)",
        fontStyle: "normal",
        fontWeight: 500,
        fontSize: size,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color,
        ...(trailingGap !== undefined ? { marginRight: trailingGap } : null),
        ...style,
      }}
    >
      <span>Relay</span>
      {/* Dot inherits 0.7em sizing + brand green + pulse animation
          from .r-mark-dot defaults in marketing.css. */}
      <span className="r-mark-dot" aria-hidden="true"></span>
    </span>
  );
}
