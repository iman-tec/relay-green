"use client";

import { useEffect, useState } from "react";

/**
 * True at ≥1024px (Tailwind `lg`) — the breakpoint where the room's home
 * dashboard switches between the three-column desktop layout and the
 * off-canvas drawer layout.
 *
 * JS media query (not CSS hiding) so stateful columns (Sidebar, chat stub)
 * are positioned by ONE source of truth and drawer state can be reset when
 * crossing the breakpoint. Initial value is read synchronously on the
 * client; RoomClient renders nothing until its own client-side load gate
 * passes, so there's no SSR/hydration mismatch window.
 */
export function useIsDesktop(query = "(min-width: 1024px)"): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return isDesktop;
}
