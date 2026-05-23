/*
 * /explainer, full-screen view of the 60-second Relay explainer video.
 *
 * Use this URL to demo the explainer or screen-record it (macOS
 * Cmd+Shift+5 / Windows Game Bar / OBS at 1920x1080) to produce an MP4.
 * Embedded in /Home's "See RELAY in action" slot via the same component.
 */

import type { Metadata } from "next";
import { Shell } from "../_marketing/Shell";
import { ExplainerVideo } from "../_marketing/ExplainerVideo";
import { JsonLd } from "../_marketing/JsonLd";
import { RelayLogo } from "../_marketing/RelayLogo";
import { videoSchema } from "../../lib/seo/schema";

const SITE_URL = "https://www.relay.green";

/*
 * Voiceover transcript, keep in sync with the `vo:` lines in
 * ExplainerVideo.tsx. The transcript serves three purposes:
 *   1. Accessibility, deaf and hard-of-hearing visitors get the script.
 *   2. SEO / AI ingestion, search engines and AI answer engines can read
 *      the video's content even when they can't render the WebGL animation.
 *   3. VideoObject JSON-LD's `transcript` field below ingests it directly.
 */
const TRANSCRIPT_BEATS: { time: string; line: string }[] = [
  {
    time: "0:00",
    line: "AI changed who can build software. The hard parts still want a software engineer.",
  },
  {
    time: "0:06",
    line: "Architecture, security, deployment, maintenance, the ninety percent behind the curtain.",
  },
  { time: "0:13", line: "Press the green dot. A software engineer joins." },
  {
    time: "0:18",
    line: "A software engineer enters your live session, on Zoom you already use.",
  },
  { time: "0:26", line: "Build. Launch. Maintain. Same team, end to end." },
  {
    time: "0:33",
    line: "One press. An engineer joins. The same engineer stays with you.",
  },
  { time: "0:40", line: "Build with AI. Ship with engineers. Relay." },
];

const FULL_TRANSCRIPT = TRANSCRIPT_BEATS.map((b) => b.line).join(" ");

export const metadata: Metadata = {
  title: "See it in action",
  description:
    "60-second explainer: how Relay connects AI builders with software engineers, from press to launch to ongoing care.",
  alternates: { canonical: "/explainer" },
};

export default function ExplainerPage() {
  return (
    <Shell>
      <JsonLd
        data={videoSchema({
          name: "Relay, See it in action",
          description:
            "60-second explainer: how Relay connects AI builders with software engineers, from press to launch to ongoing care.",
          thumbnailUrl: `${SITE_URL}/opengraph-image`,
          uploadDate: "2026-05-01",
          embedUrl: `${SITE_URL}/explainer`,
          duration: "PT45S",
          transcript: FULL_TRANSCRIPT,
        })}
      />

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
                fontFamily: "var(--font-source-serif)",
                fontWeight: 400,
                fontSize: "clamp(32px, 4.6vw, 56px)",
                letterSpacing: "-0.022em",
                lineHeight: 1.05,
                margin: "0 0 12px",
                color: "var(--cream)",
              }}
            >
              See <RelayLogo size="0.78em" />{" "}
              <em style={{ color: "var(--green)" }}>in action.</em>
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
              Forty-five seconds on why Relay exists, how the press works, and
              the operational depth behind it. Voiceover plays through your
              browser, toggle the speaker icon to mute.
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

          <details
            style={{
              marginTop: 48,
              maxWidth: "60ch",
              marginInline: "auto",
              color: "rgba(244,242,238,0.85)",
              borderTop: "1px solid rgba(244,242,238,0.12)",
              paddingTop: 24,
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                fontFamily: "var(--font-jetbrains)",
                fontSize: 12,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(244,242,238,0.65)",
                marginBottom: 16,
              }}
            >
              Read the transcript
            </summary>
            <ol
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {TRANSCRIPT_BEATS.map((beat) => (
                <li
                  key={beat.time}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 1fr",
                    gap: 16,
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains)",
                      fontSize: 12,
                      color: "rgba(244,242,238,0.5)",
                      paddingTop: 2,
                    }}
                  >
                    {beat.time}
                  </span>
                  <span>{beat.line}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      </section>
    </Shell>
  );
}
