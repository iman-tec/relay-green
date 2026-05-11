/*
 * /resources/blog/when-does-an-ai-build-want-a-person — Research.
 *
 * Server component. Sub-headed research write-up under the marketing Shell.
 */

import type { Metadata } from "next";
import { Shell } from "../../../_marketing/Shell";
import { TryRelayButton } from "../../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title:
    "Relay — When does an AI build want a person? A study of 4,200 stuck moments.",
  description:
    "We logged every press in the first quarter of the private beta. Four patterns explain almost everything.",
};

const bodyStyle = {
  fontSize: 16,
  lineHeight: 1.65,
  marginBottom: 14,
  maxWidth: "62ch",
} as const;

const h4Style = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  fontSize: 22,
  marginTop: 32,
  marginBottom: 12,
} as const;

export default function ResearchPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">
            Research · Relay Research team · April 2026 · 17 min read
          </span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            When does an <em>AI build</em>
            <br />
            want a person?
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            We logged every press in the first quarter of the private beta.
            Four patterns explain almost everything.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <article>
            <p className="r-body" style={bodyStyle}>
              Between February and April 2026, beta customers pressed for an
              engineer 4,217 times. Each press is a moment a person building
              software with an AI decided that the next step was easier with a
              human in the room. We labeled every session by what happened in
              the seconds before the press, and again by what happened
              in the thirty minutes after. Four categories cover 92% of the
              sample.
            </p>

            <h4 style={h4Style}>One. The confidence wall (38%)</h4>
            <p className="r-body" style={bodyStyle}>
              The build technically works. The builder has clicked through it
              ten times. They cannot bring themselves to ship it because they
              do not know if it will hold. They press for a person who will
              read it once and answer one question:{" "}
              <em>can I send this to a customer?</em> Average session length:
              14 minutes. Resolution rate: 96%.
            </p>

            <h4 style={h4Style}>Two. The integration cliff (29%)</h4>
            <p className="r-body" style={bodyStyle}>
              The AI produced a complete, runnable artifact. Connecting it to
              anything outside the sandbox &mdash; a database, an auth
              provider, a payment gateway, an email service &mdash; fails
              repeatedly in non-obvious ways. The builder presses. Average
              session length: 41 minutes. Resolution rate: 89%.
            </p>

            <h4 style={h4Style}>Three. The deploy moment (17%)</h4>
            <p className="r-body" style={bodyStyle}>
              The build runs locally. The builder has a domain. They have not
              deployed software before. They press because the gap between
              &ldquo;works on my machine&rdquo; and &ldquo;works in
              production&rdquo; turns out to be most of the work. Average
              session length: 1h 12min. Resolution rate: 94%.
            </p>

            <h4 style={h4Style}>Four. The ownership question (8%)</h4>
            <p className="r-body" style={bodyStyle}>
              The build is shipped. Something has changed in the world &mdash;
              a payment failed, a user reported a bug, a third-party API
              silently changed shape. The builder presses because the build
              has stopped being a build and started being a system, and
              systems want a person to own them. Resolution rate: 99%;
              mean-time-to-resolve: 23 minutes; relationships continued: 71%.
            </p>

            <h4 style={h4Style}>The 8% that doesn&rsquo;t fit</h4>
            <p className="r-body" style={bodyStyle}>
              About one in twelve presses we couldn&rsquo;t cleanly classify.
              They&rsquo;re mostly conversations. The build is fine; the
              builder wants a second opinion on a decision that isn&rsquo;t
              really a code decision (a vendor, an architecture choice,
              whether to rewrite). We think this is its own category and will
              keep watching it.
            </p>

            <p className="r-body" style={bodyStyle}>
              The takeaway, for us, is that the press isn&rsquo;t random. It
              clusters around four legible moments, and the fastest path to
              making AI builds reliable is to make the press cheap, instant,
              and obvious at exactly those four moments. That&rsquo;s the
              design of the desktop, and increasingly the design of every
              integration.
            </p>

            <p
              style={{
                fontStyle: "italic",
                color: "var(--ink-mute)",
                fontSize: 14,
                marginTop: 32,
              }}
            >
              &mdash; Relay Research, with help from the engineering team.
              Anonymized, aggregated. Methodology note available on request.
            </p>
          </article>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Four moments.
            <br />
            <em>One press.</em>
          </h2>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <TryRelayButton />
          </div>
        </div>
      </section>
    </Shell>
  );
}
