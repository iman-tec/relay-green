"use client";

/*
 * The shared "Try Relay" button. Triggers the global modal via context.
 * Two visual variants: "pill" (used in nav + CTA banner) and "ghost-cta"
 * (used in hero, where the green pill sits next to a ghost button).
 */

import type { CSSProperties } from "react";
import { useTryRelay } from "./TryRelayProvider";

export function TryRelayButton({
  className = "r-try-relay",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { open } = useTryRelay();
  return (
    <button type="button" className={className} style={style} onClick={open}>
      <span
        className="r-dot"
        style={{ ["--dot-size" as string]: "10px" }}
      ></span>
      <span>Try Relay</span>
      <span className="arrow">→</span>
    </button>
  );
}
