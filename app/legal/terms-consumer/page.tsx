/*
 * /legal/terms-consumer, Plain-English terms for the Try Relay personal tier.
 *
 * Server component. Brief placeholder mirroring the structure of the
 * commercial agreement; the full consumer prose lands when the personal
 * tier opens. `robots: { index: false }` keeps it out of public search
 * results until then.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Terms (Consumer)",
  description:
    "Plain-English version of the commercial terms, for individuals on the Try Relay personal tier.",
  alternates: { canonical: "/legal/terms-consumer" },
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

export default function TermsConsumerPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Terms (Consumer)</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Terms (Consumer).</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: May 2026
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{ paddingTop: 0, borderTop: "none" }}
      >
        <div className="r-wrap-narrow">
          <p className="r-body" style={bodyStyle}>
            Plain-English version of the commercial terms, for individuals using
            the Try Relay personal tier. Two pages, eighth-grade reading level.
            The headers below mirror the{" "}
            <Link
              href="/legal/terms-commercial"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Commercial Terms
            </Link>{" "}
            so you can compare them side by side.
          </p>

          <h3 style={h3Style}>What you&rsquo;re buying</h3>
          <p className="r-body" style={bodyStyle}>
            One press, one engineer, for personal builds. We&rsquo;ll spell this
            out in plain language before launch.
          </p>

          <h3 style={h3Style}>What we promise</h3>
          <p className="r-body" style={bodyStyle}>
            A software engineer, on the timeline we quote you when you press. We
            will not ship code we know does not work.
          </p>

          <h3 style={h3Style}>What you promise</h3>
          <p className="r-body" style={bodyStyle}>
            Pay what we agreed. Don&rsquo;t use Relay to do anything in the{" "}
            <Link
              href="/legal/acceptable-use"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Acceptable Use Policy
            </Link>
            .
          </p>

          <h3 style={h3Style}>Confidentiality and IP</h3>
          <p className="r-body" style={bodyStyle}>
            What you make is yours. What we see in your session, we keep to
            ourselves.
          </p>

          <h3 style={h3Style}>Term, termination, refunds</h3>
          <p className="r-body" style={bodyStyle}>
            Cancel anytime. Pro-rated refund if we drop the ball.
          </p>

          <h3 style={h3Style}>Liability</h3>
          <p className="r-body" style={bodyStyle}>
            Our liability is capped at what you&rsquo;ve paid us in the last
            year. Some things, fraud, willful misconduct, and anything the law
            says we can&rsquo;t cap, aren&rsquo;t.
          </p>

          <h3 style={h3Style}>Governing law</h3>
          <p className="r-body" style={bodyStyle}>
            Same regional rules as the commercial agreement, applied to your
            billing address.
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
            ,{" "}
            <Link
              href="/legal/cookies"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Cookies
            </Link>
            .
          </div>
        </div>
      </section>
    </Shell>
  );
}
