/*
 * /trust/responsible-disclosure, How to report a vulnerability.
 *
 * Scope, safe harbor, contact, PGP key (placeholder), response SLA,
 * and recognition policy. No bug bounty at launch; a single line of
 * type explains why and what to expect instead.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Responsible disclosure",
  description:
    "How to report a vulnerability to Relay. Scope, safe harbor, contact, response SLA, and recognition policy.",
  alternates: { canonical: "/trust/responsible-disclosure" },
  robots: { index: false, follow: false },
};

const IN_SCOPE = [
  "relay.green and all subdomains",
  "The Relay desktop and IDE extensions",
  "The press-for-an-engineer browser overlay",
  "Public APIs documented at api.relay.green",
];

const OUT_OF_SCOPE = [
  "Social engineering of Relay engineers, customers, or vendors",
  "Physical attacks on Relay facilities",
  "Denial-of-service tests against production",
  "Findings already disclosed in our changelog or known-issues page",
  "Best-practice recommendations without a working proof of concept",
];

export default function TrustResponsibleDisclosurePage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Trust · Responsible disclosure</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Found something? <em>Tell us first.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            Researchers acting in good faith are welcome here. The terms below
            describe what is in scope, how to reach the security team, and what
            you should expect after the report lands.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Contact.</h2>
          <div
            style={{
              padding: "28px 28px",
              border: "1px solid #d2d2d7",
              borderRadius: "var(--radius)",
              background: "var(--cream-2)",
              marginBottom: 16,
            }}
          >
            <p
              className="r-small"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                marginBottom: 6,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Email
            </p>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 17,
                color: "var(--ink)",
                margin: 0,
              }}
            >
              <a
                href="mailto:support@relay.green"
                style={{ borderBottom: "1px solid var(--ink)" }}
              >
                support@relay.green
              </a>
            </p>
          </div>
          <div
            style={{
              padding: "28px 28px",
              border: "1px solid #d2d2d7",
              borderRadius: "var(--radius)",
              background: "var(--cream-2)",
            }}
          >
            <p
              className="r-small"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                marginBottom: 6,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              PGP key fingerprint
            </p>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                color: "var(--ink-soft)",
                margin: 0,
              }}
            >
              Available on request after initial contact.
            </p>
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Scope.</h2>
          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
            }}
          >
            <div>
              <h3 className="r-h-3" style={{ marginBottom: 12 }}>
                In scope
              </h3>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  fontSize: 14,
                  color: "var(--ink-2)",
                  lineHeight: 1.7,
                }}
              >
                {IN_SCOPE.map((s) => (
                  <li key={s} style={{ paddingLeft: 18, position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        color: "var(--green)",
                      }}
                    >
                      ·
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="r-h-3" style={{ marginBottom: 12 }}>
                Out of scope
              </h3>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  fontSize: 14,
                  color: "var(--ink-2)",
                  lineHeight: 1.7,
                }}
              >
                {OUT_OF_SCOPE.map((s) => (
                  <li key={s} style={{ paddingLeft: 18, position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        color: "var(--clay)",
                      }}
                    >
                      ·
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Safe harbor.</h2>
          <p className="r-body">
            Relay will not initiate or support legal action against researchers
            who act in good faith, stay within the in-scope assets, do not
            access more data than required to demonstrate a finding, and report
            promptly. We will work with you on coordinated disclosure timing ,
            our default is to publish a fix and an acknowledgment together.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Response SLA.</h2>
          <p className="r-body" style={{ marginBottom: 16 }}>
            Initial acknowledgment within <strong>five business days</strong>. A
            triage decision and a severity rating within ten. Status updates
            every two weeks until resolution. We will not silently close a
            report.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Recognition.</h2>
          <p className="r-body" style={{ marginBottom: 12 }}>
            Researchers whose reports lead to a confirmed fix are listed on a
            public hall-of-fame page, with permission. Where reports prevent
            material customer harm, we may offer swag or a discretionary
            thank-you payment.
          </p>
          <p className="r-body">
            <em>No bug bounty at launch; under review.</em> We would rather run
            a small, slow, careful program than a loud one. The terms above are
            what we can commit to today.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <TryRelayButton />
            <Link href="/trust" className="r-btn r-btn-ghost">
              ← Back to Trust
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
