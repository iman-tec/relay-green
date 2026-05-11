"use client";

/*
 * The shared "Try Relay" button. Navigates to /login (sign-in page).
 * Two visual variants: "pill" (used in nav + CTA banner) and "ghost-cta"
 * (used in hero, where the green pill sits next to a ghost button).
 */

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

export function TryRelayButton({
  className = "r-try-relay",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();
  return (
    <button type="button" className={className} style={style} onClick={() => router.push("/login")}>
      <span
        className="r-dot"
        style={{ ["--dot-size" as string]: "10px" }}
      ></span>
      <span>Try Relay</span>
      <span className="arrow">→</span>
    </button>
  );
}
