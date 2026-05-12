/*
 * Editorial hero for the Relay marketing site.
 *
 * Server component: the H1, lede, and CTAs render in initial HTML so the
 * largest contentful paint is the headline (sub-200ms on a warm cache).
 * The Spline 3D scene is offloaded to <SplineBackground />, a client-only
 * island that lazy-loads the WebGL runtime via next/dynamic after first
 * paint and skips itself entirely if prefers-reduced-motion is set.
 *
 * The cream→transparent left-side gradient (rendered via the hero's
 * ::before pseudo) keeps the text column legible over whatever the 3D
 * scene is doing without dimming the right half.
 */

import Link from "next/link";
import ReactDOM from "react-dom";
import { TryRelayButton } from "./TryRelayButton";
import { SplineBackground } from "./SplineBackground";
import { RelayLogo } from "./RelayLogo";

const SPLINE_SCENE_URL =
  "https://prod.spline.design/IU3NwT-PryTFjbq8/scene.splinecode";

export function SplineHero() {
  // Warm up the Spline scene file download in parallel with the
  // SplineBackground JS chunk. The scene binary is non-critical (the CSS
  // poster gradient on .r-spline-bg covers the area until WebGL mounts),
  // so we explicitly request it at LOW priority so the browser doesn't
  // contend it against critical CSS, fonts, and the H1 paint. The result
  // is faster LCP + a smoother handoff once Spline is ready.
  // React 19 hoists this hint into the document <head> when the server
  // component renders.
  ReactDOM.preload(SPLINE_SCENE_URL, {
    as: "fetch",
    crossOrigin: "anonymous",
    fetchPriority: "low",
  });

  // Also pre-warm the connection to Spline's CDN, saves the DNS +
  // TLS round-trip when the runtime later opens the asset stream.
  ReactDOM.preconnect("https://prod.spline.design", {
    crossOrigin: "anonymous",
  });

  return (
    <section className="r-hero">
      <div className="r-spline-bg" aria-hidden="true">
        <SplineBackground />
        <div className="r-spline-tint"></div>
      </div>

      <div className="r-wrap">
        <div className="r-hero-content">
          <div
            className="r-hero-tagline"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              color: "var(--ink-soft)",
              flexWrap: "wrap",
            }}
          >
            <RelayLogo size={11} trailingGap={12} />
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 500,
                fontSize: 11,
                color: "var(--ink-soft)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              AI didn’t replace engineers. It multiplied builders.
            </span>
          </div>
          <h1 className="r-h-display">
            Build with AI.
            <br />
            Ship with <em>engineers.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 28, maxWidth: "54ch" }}>
            <RelayLogo size="1em" color="var(--ink)" /> connects AI builders
            with real engineers.
          </p>
          <ul className="r-hero-moments" aria-label="When Relay helps">
            <li>
              <span className="r-hero-moments-dot" aria-hidden="true" />
              When you get stuck.
            </li>
            <li>
              <span className="r-hero-moments-dot" aria-hidden="true" />
              When you’re ready to launch.
            </li>
            <li>
              <span className="r-hero-moments-dot" aria-hidden="true" />
              When your product needs ongoing support.
            </li>
          </ul>
          <div className="r-hero-modalities" aria-label="Session modalities">
            Chat · Voice · Screen
          </div>
          <div className="r-hero-cta">
            <TryRelayButton />
            <Link href="/product" className="r-btn r-btn-ghost">
              See how it works <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
