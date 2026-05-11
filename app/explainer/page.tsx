/*
 * /explainer — full-screen view of the 60-second Relay explainer video.
 *
 * Use this URL to demo the explainer or screen-record it (macOS
 * Cmd+Shift+5 / Windows Game Bar / OBS at 1920x1080) to produce an MP4.
 * Embedded in /Home's "See RELAY in action" slot via the same component.
 */

import type { Metadata } from "next";
import { Shell } from "../_marketing/Shell";
import { ExplainerVideo } from "../_marketing/ExplainerVideo";

export const metadata: Metadata = {
  title: "Relay — See it in action",
  description:
    "60-second explainer: how Relay connects AI builders with senior engineers — from press to launch to ongoing care.",
};

export default function ExplainerPage() {
  return (
    <Shell>
      <section
        style={{
          padding: "48px 0 80px",
          background: "var(--ink)",
        }}
      >
        <div className="r-wrap-narrow">
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(244,242,238,0.5)",
                marginBottom: 18,
              }}
            >
              Relay · Explainer · 0:45 with voiceover
            </div>
            <h1
              style={{
                fontFamily: "var(--font-fraunces)",
                fontWeight: 400,
                fontSize: "clamp(32px, 4.6vw, 56px)",
                letterSpacing: "-0.022em",
                lineHeight: 1.05,
                margin: "0 0 12px",
                color: "var(--cream)",
              }}
            >
              See{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  fontFamily: "var(--font-instrument-sans)",
                  fontWeight: 500,
                  fontSize: "0.78em",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Relay
                <span
                  style={{
                    width: "0.5em",
                    height: "0.5em",
                    borderRadius: "50%",
                    background: "var(--green)",
                    display: "inline-block",
                    marginLeft: 1,
                  }}
                ></span>
              </span>{" "}
              <em style={{ color: "#a4c074" }}>in action.</em>
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "rgba(244,242,238,0.6)",
                maxWidth: "52ch",
                margin: "0 auto",
                lineHeight: 1.55,
              }}
            >
              Forty-five seconds on why Relay exists, how the press works,
              and the operational depth behind it. Voiceover plays through
              your browser — toggle the speaker icon to mute.
            </p>
          </div>

          <ExplainerVideo />

          <div
            style={{
              marginTop: 24,
              display: "flex",
              justifyContent: "center",
              gap: 16,
              flexWrap: "wrap",
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "rgba(244,242,238,0.5)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            <span>7 beats · 45 seconds · Voiceover via Web Speech API</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>Screen-record with system audio to export MP4</span>
          </div>
        </div>
      </section>
    </Shell>
  );
}
