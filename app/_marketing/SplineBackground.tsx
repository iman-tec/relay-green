"use client";

/*
 * Client-only Spline 3D background for the hero.
 *
 * Why this is in its own file:
 *   1. We want the hero text + CTAs to be server-rendered (so the H1 lands
 *      in initial HTML and can be the LCP element). Splitting Spline out
 *      lets SplineHero stay a server component.
 *   2. We dynamically import the @splinetool/react-spline package with
 *      `ssr: false`, so its WebGL runtime doesn't ship in the SSR HTML
 *      payload. The chunk request kicks off only after the page is idle
 *      (see `useDeferredMount` below) so it never competes with hydration,
 *      LCP-critical CSS/fonts, or the H1 paint. Combined with
 *      `experimental.optimizePackageImports` in next.config.ts and the
 *      CSS poster gradient on `.r-spline-bg`, the result is: HTML lands
 *      first (fast LCP), the area looks finished thanks to the gradient,
 *      and the live WebGL canvas fades in once the runtime is ready.
 *
 * If the user prefers reduced motion, we skip mounting Spline entirely;
 * the CSS poster + tint stays as a finished-looking static visual.
 *
 * We read prefers-reduced-motion via useSyncExternalStore (React 18+
 * canonical pattern for syncing to non-React state) so the hook is
 * hydration-safe and doesn't trip the react-hooks/set-state-in-effect
 * cascading-renders lint rule.
 */

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";

const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => null,
});

const SPLINE_SCENE =
  "https://prod.spline.design/IU3NwT-PryTFjbq8/scene.splinecode";

const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduceMotion(onChange: () => void): () => void {
  const mql = window.matchMedia(REDUCE_MOTION_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getReduceMotion(): boolean {
  return window.matchMedia(REDUCE_MOTION_QUERY).matches;
}

// SSR snapshot: assume motion is allowed at render time. The real value
// comes in immediately on hydration; if the user has reduced motion set
// the Spline component returns null on the next render, no animation
// mounted.
const getReduceMotionServer = (): boolean => false;

/*
 * Wait until the browser is idle before signalling "go". This keeps the
 * Spline JS chunk request and the heavy WebGL init off the critical path
 * for hydration + LCP. On browsers without requestIdleCallback (Safari
 * pre-16.4) the setTimeout fallback fires after the same UX threshold.
 */
function useDeferredMount(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    type IdleHandle = number;
    type IdleCb = (deadline: { didTimeout: boolean }) => void;
    type IdleApi = {
      requestIdleCallback?: (
        cb: IdleCb,
        opts?: { timeout: number }
      ) => IdleHandle;
      cancelIdleCallback?: (handle: IdleHandle) => void;
    };
    const w = window as unknown as IdleApi;
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(() => setReady(true), {
        timeout: 1500,
      });
      return () => w.cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(t);
  }, []);
  return ready;
}

export function SplineBackground() {
  const reduceMotion = useSyncExternalStore(
    subscribeReduceMotion,
    getReduceMotion,
    getReduceMotionServer
  );
  const ready = useDeferredMount();
  const [loaded, setLoaded] = useState(false);
  if (reduceMotion) return null;
  if (!ready) return null;
  // Wrapper carries the opacity transition (data-loaded attr toggled by
  // Spline's onLoad callback). Until the scene is fully ready, the wrapper
  // is invisible and the CSS poster gradient on .r-spline-bg shows. See
  // marketing.css `.r-spline-fade`.
  return (
    <div className="r-spline-fade" data-loaded={loaded ? "true" : "false"}>
      <Spline scene={SPLINE_SCENE} onLoad={() => setLoaded(true)} />
    </div>
  );
}
