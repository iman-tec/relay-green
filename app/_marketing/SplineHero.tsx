"use client";

/*
 * Editorial hero for the Relay marketing site.
 *
 * The Spline 3D scene is a full-bleed background of the hero section. A
 * cream→transparent left-side gradient (rendered via the hero's ::before
 * pseudo) keeps the text column legible over whatever the 3D scene is
 * doing without dimming the right half. Spline runs WebGL in a client
 * boundary; everything else on this page renders server-side.
 */

import Link from "next/link";
import Spline from "@splinetool/react-spline";
import { TryRelayButton } from "./TryRelayButton";

const SPLINE_SCENE =
  "https://prod.spline.design/IU3NwT-PryTFjbq8/scene.splinecode";

export function SplineHero() {
  return (
    <section className="r-hero">
      <div className="r-spline-bg" aria-hidden="true">
        <Spline scene={SPLINE_SCENE} />
        <div className="r-spline-tint"></div>
      </div>

      <div className="r-wrap">
        <div className="r-hero-content">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              marginBottom: 32,
              color: "var(--ink-soft)",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontSize: 11,
              }}
            >
              Relay
            </span>
            <span className="r-mark-dot"
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "var(--green)",
                display: "inline-block",
                marginLeft: 0,
                marginRight: 12,
              }}></span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 14,
                color: "var(--ink-soft)",
                letterSpacing: "-0.005em",
                textTransform: "none",
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
            RELAY connects AI builders with real engineers when they get
            stuck, when they’re ready to launch, and when their product
            needs ongoing support. Connect, chat, talk, or screen.
          </p>
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
