"use client";

/*
 * Thin, brand-green progress bar pinned to the top of the viewport.
 *
 * Two complementary triggers so users always see *something* when they
 * click a link:
 *
 * 1. Synchronous click on any internal link → start the bar immediately,
 *    so feedback happens BEFORE the new route's server components have
 *    even been requested. The bar holds at ~90% while we wait.
 *
 * 2. usePathname() flips to the new path → complete the bar to 100%
 *    and fade it out. If the new page also has a `loading.tsx` we'll
 *    already have transitioned to that skeleton in parallel.
 *
 * Mounted once in the root layout — affects every navigable surface.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const BRAND_GREEN = "#3f5c2e";

export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [progress, setProgress] = useState(0);

  // Trigger 1 — listen for any same-origin link click on the page. Starts
  // the bar synchronously, no React round-trip needed.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      // External or new-tab links don't trigger a client nav.
      const target = anchor.getAttribute("target");
      if (target && target !== "_self") return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        // Same path = no nav.
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch { return; }
      setPhase("loading");
      setProgress(8);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // While loading, ramp progress toward ~90% so the bar always looks
  // alive even on slow routes. Caps before 100 so we never lie about
  // completion — the pathname-change effect below finishes it.
  useEffect(() => {
    if (phase !== "loading") return;
    let raf = 0;
    const tick = () => {
      setProgress((p) => {
        if (p >= 90) return p;
        // Ease toward 90: bigger jumps when far, smaller as we approach.
        const next = p + Math.max(0.4, (90 - p) * 0.06);
        return Math.min(90, next);
      });
      raf = window.setTimeout(tick, 60) as unknown as number;
    };
    raf = window.setTimeout(tick, 60) as unknown as number;
    return () => window.clearTimeout(raf);
  }, [phase]);

  // Trigger 2 — pathname changed: complete and fade.
  useEffect(() => {
    if (phase === "idle") return;
    setProgress(100);
    setPhase("done");
    const t = window.setTimeout(() => {
      setPhase("idle");
      setProgress(0);
    }, 280);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const visible = phase !== "idle";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[1000] h-[2px]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 220ms ease" }}
    >
      <div
        className="h-full"
        style={{
          width: `${progress}%`,
          background: `linear-gradient(to right, ${BRAND_GREEN}, color-mix(in srgb, ${BRAND_GREEN} 60%, transparent))`,
          boxShadow: `0 0 8px ${BRAND_GREEN}`,
          transition: phase === "done"
            ? "width 220ms ease-out"
            : "width 180ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </div>
  );
}
