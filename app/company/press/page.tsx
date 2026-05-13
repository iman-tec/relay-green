/*
 * /company/press — Press kit.
 *
 * Boilerplate copy a journalist or PR person can lift. Three lengths of
 * description, founder quotes, brand-asset list (downloads coming soon),
 * press contact. Sourced from §13 of the content plan.
 */

import type { Metadata } from "next";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — Press kit",
  description:
    "Boilerplate, founder quotes, and brand assets for journalists, partners, and analysts. Press contact: support@relay.green.",
};

export default function PressPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">— Company · Press</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Press kit. Boilerplate.
            <br />
            <em>The dot in every format you'll need.</em>
          </h1>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <span className="r-eyebrow">One-line description</span>
          <p
            className="r-lede"
            style={{ marginTop: 16, fontStyle: "italic", color: "var(--ink)" }}
          >
            Relay puts a senior software engineer one press away from any AI
            build.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <span className="r-eyebrow">Three-sentence boilerplate</span>
          <p className="r-body" style={{ marginTop: 16 }}>
            Relay is the on-demand human layer for AI-built software. Builders
            working in tools like Claude, Cursor, and Lovable press a single
            button mid-build, and a senior Relay engineer joins their session
            in seconds — staying through launch and, if they want, after.
            Headquartered in Manhattan, funded by The Asgard Fund and operated
            with NINtec Systems (NSE/BSE: NINSYS), Relay's engineers cover
            fifteen-plus countries on a follow-the-sun model.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <span className="r-eyebrow">
            Long boilerplate · for filings, awards, partner pages
          </span>
          <p className="r-body" style={{ marginTop: 16 }}>
            Relay, Inc. (relay.green) is a New York-headquartered software
            company building the human layer behind AI-built software. Through
            a single &ldquo;press for a human&rdquo; gesture in popular AI
            build tools, Relay matches a builder with a vetted senior engineer
            in a median match in seconds, and that engineer pairs through to a
            working, shipped, maintained outcome. Relay is funded by The
            Asgard Fund (Amsterdam) and operated in partnership with NINtec
            Systems (NSE/BSE: NINSYS), giving Relay engineering reach across
            more than fifteen countries on a follow-the-sun service model.
            Founded in 2026.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <span className="r-eyebrow">Founder quotes · placeholder until naming</span>
          <blockquote
            style={{
              margin: "24px 0 24px",
              padding: "0 0 0 20px",
              borderLeft: "2px solid var(--green)",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 22,
              lineHeight: 1.4,
              color: "var(--ink)",
            }}
          >
            &ldquo;The cost of writing software fell. The cost of being sure
            it should ship didn't. Relay is for that second cost.&rdquo;
            <footer
              style={{
                marginTop: 12,
                fontFamily: "var(--font-sans)",
                fontStyle: "normal",
                fontSize: 13,
                color: "var(--ink-soft)",
              }}
            >
              — Co-founder &amp; CEO
            </footer>
          </blockquote>
          <blockquote
            style={{
              margin: "24px 0",
              padding: "0 0 0 20px",
              borderLeft: "2px solid var(--green)",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 22,
              lineHeight: 1.4,
              color: "var(--ink)",
            }}
          >
            &ldquo;We're not building an agency, and we're not building a
            freelancing marketplace. We're building a press.&rdquo;
            <footer
              style={{
                marginTop: 12,
                fontFamily: "var(--font-sans)",
                fontStyle: "normal",
                fontSize: 13,
                color: "var(--ink-soft)",
              }}
            >
              — Co-founder &amp; CTO
            </footer>
          </blockquote>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <span className="r-eyebrow">Brand assets</span>
          <h2 className="r-h-2" style={{ marginTop: 16 }}>
            Downloads <em>coming soon.</em>
          </h2>
          <p className="r-body" style={{ marginBottom: 24 }}>
            The full asset bundle is in production. The list below describes
            what will ship; in the meantime, email{" "}
            <a
              href="mailto:support@relay.green"
              style={{
                borderBottom: "1px solid var(--ink)",
                paddingBottom: 1,
              }}
            >
              support@relay.green
            </a>{" "}
            for any specific format.
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              borderTop: "1px solid var(--rule)",
            }}
          >
            {[
              "RELAY wordmark · SVG · light, dark, green block",
              "The dot · SVG + PNG at 16, 32, 64, 128, 256, 512 px",
              "Color tokens · cream #f4f2ee · ink #1a1815 · moss green #4f6b3a",
              "Typography · Fraunces (display) · Inter (UI) · JetBrains Mono",
              "Desktop screenshots · placeholder; final after public launch",
              "Founder photos · placeholder",
              "One-page company fact sheet · PDF",
            ].map((item) => (
              <li
                key={item}
                style={{
                  padding: "16px 0",
                  borderBottom: "1px solid var(--rule)",
                  fontSize: 15,
                  color: "var(--ink-2)",
                }}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <span className="r-eyebrow">Press contact</span>
          <p className="r-body" style={{ marginTop: 16 }}>
            <a
              href="mailto:support@relay.green"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                color: "var(--ink)",
                borderBottom: "1px solid var(--ink)",
                paddingBottom: 2,
              }}
            >
              support@relay.green
            </a>
            <br />
            <span className="r-small" style={{ marginTop: 12, display: "inline-block" }}>
              We aim to respond within one business day.
            </span>
          </p>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            The dot, live —
            <br />
            <em>see it in your own tool.</em>
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
