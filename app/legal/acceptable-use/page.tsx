/*
 * /legal/acceptable-use, Acceptable Use Policy.
 *
 * One paragraph from section 10 of content.html, with a short
 * "Why this exists" intro. Single source of truth for what we will
 * not staff a press for.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description:
    "What you may not press a Relay engineer to do. Short, declarative, scoped narrowly.",
  alternates: { canonical: "/legal/acceptable-use" },
  robots: { index: false, follow: false },
};

const h3Style = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  fontSize: 24,
  marginTop: 32,
  marginBottom: 12,
  letterSpacing: "-0.01em",
};

const bodyStyle = { fontSize: 16, lineHeight: 1.65 };

const footerLineStyle = {
  marginTop: 64,
  paddingTop: 24,
  borderTop: "1px solid var(--rule)",
  fontSize: 14,
  color: "var(--ink-soft)",
};

export default function AcceptableUsePage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Acceptable Use</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Acceptable Use Policy.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: June 2026
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{ paddingTop: 0, borderTop: "none" }}
      >
        <div className="r-wrap-narrow">
          <h3 style={h3Style}>Why this exists</h3>
          <p className="r-body" style={bodyStyle}>
            Relay engineers are real people. Pressing for one is pressing for a
            colleague&rsquo;s time. We will not let that gesture be turned into
            something we, or the engineer who shows up, would refuse on ethical
            grounds. This policy is the short list of work we will not staff ,
            and the only list. We don&rsquo;t hide anything else behind
            &ldquo;at our discretion.&rdquo; Everything else, we answer.
          </p>

          <h3 style={h3Style}>What you may not press for</h3>
          <p className="r-body" style={bodyStyle}>
            You may not press for a Relay engineer to: build malware; build
            content that sexually exploits minors; build software whose primary
            purpose is to deceive a person about who they are interacting with;
            build tools that surveil people without their knowledge; circumvent
            another company&rsquo;s security; violate a sanctioned-party export
            control. We reserve the right to decline any session for any reason;
            we will tell you why.
          </p>

          <h3 style={h3Style}>What happens if you do</h3>
          <p className="r-body" style={bodyStyle}>
            The engineer leaves the session. Your account is paused while we
            review. Repeat or severe violations are grounds for termination
            under the{" "}
            <Link
              href="/legal/terms-commercial"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Commercial Terms
            </Link>{" "}
            or{" "}
            <Link
              href="/legal/terms-consumer"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Consumer Terms
            </Link>
            , as applicable. If we&rsquo;re compelled by law to report, we will,
            and we&rsquo;ll tell you we did unless we&rsquo;re legally barred.
          </p>

          <div style={footerLineStyle}>
            Questions?{" "}
            <a
              href="mailto:support@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              support@relay.green
            </a>
            . See also:{" "}
            <Link
              href="/legal/privacy-policy"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Privacy Policy
            </Link>
            .
          </div>
        </div>
      </section>
    </Shell>
  );
}
