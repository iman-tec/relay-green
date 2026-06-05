/*
 * /legal/terms-commercial, Master commercial terms.
 *
 * Server component. Prose lifted from the section-10 working draft.
 * Final wording will replace this when contracts are negotiated;
 * `robots: { index: false }` keeps it out of public search results
 * until then.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Terms (Commercial)",
  description:
    "What you're buying, what we promise, what you promise. Plain English.",
  alternates: { canonical: "/legal/terms-commercial" },
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

const h4Style = {
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  fontSize: 14,
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  marginTop: 24,
  marginBottom: 8,
  color: "var(--ink-mute)",
};

const bodyStyle = { fontSize: 16, lineHeight: 1.65 };

const footerLineStyle = {
  marginTop: 64,
  paddingTop: 24,
  borderTop: "1px solid var(--rule)",
  fontSize: 14,
  color: "var(--ink-soft)",
};

export default function TermsCommercialPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Terms (Commercial)</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Terms (Commercial).</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: June 2026. The master agreement for teams and
            companies on a paid plan.
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{ paddingTop: 0, borderTop: "none" }}
      >
        <div className="r-wrap-narrow">
          <h3 style={h3Style}>What you&rsquo;re buying</h3>
          <p className="r-body" style={bodyStyle}>
            The right, for your team, to press for a senior Relay engineer and
            have one show up. The right to have that engineer pair with your
            team, modify your code, deploy with your permission, and stay on
            retainer if you and they agree.
          </p>

          <h3 style={h3Style}>What we promise</h3>
          <p className="r-body" style={bodyStyle}>
            Median time-to-engineer in seconds during your contracted hours.
            Senior, vetted engineers. SOC 2 and GDPR-aligned posture. Customer
            always owns the code we touch. We will fix bugs we introduce; we
            will not knowingly ship code that does not work.
          </p>

          <h3 style={h3Style}>What you promise</h3>
          <p className="r-body" style={bodyStyle}>
            Pay your invoice on the terms in your order form. Do not press for
            engineers to do work that violates our{" "}
            <Link
              href="/legal/acceptable-use"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Acceptable Use Policy
            </Link>
            . Don&rsquo;t reverse-engineer the desktop. Tell us if a Relay
            engineer behaves in a way you wouldn&rsquo;t tolerate from your own.
          </p>

          <h3 style={h3Style}>Confidentiality and IP</h3>
          <p className="r-body" style={bodyStyle}>
            Mutual NDA included by default. Customer owns all output of any
            Relay session. Relay retains rights to general know-how the engineer
            carries between sessions; we never use one customer&rsquo;s code to
            do another customer&rsquo;s work.
          </p>

          <h3 style={h3Style}>Term, termination, refunds</h3>
          <p className="r-body" style={bodyStyle}>
            Monthly subscriptions auto-renew; cancel any time before the next
            billing date. Annual subscriptions cancel at term end. Pro-rated
            refund if we materially fail to deliver. Termination for cause on 30
            days&rsquo; notice, either way.
          </p>

          <h3 style={h3Style}>Liability</h3>
          <p className="r-body" style={bodyStyle}>
            Capped at fees paid in the prior 12 months. Indirect damages
            excluded. Nothing in this contract limits liability for fraud,
            willful misconduct, or anything that can&rsquo;t lawfully be
            limited.
          </p>

          <h3 style={h3Style}>Governing law</h3>
          <p className="r-body" style={bodyStyle}>
            For US customers: New York. For EU customers: Netherlands. For UK
            customers: England and Wales. For India customers: Maharashtra.
            Disputes go to arbitration first; we do not pursue class action.
          </p>

          <h4 style={h4Style}>Companion documents</h4>
          <p className="r-body" style={bodyStyle}>
            These commercial terms are read together with our{" "}
            <Link
              href="/legal/privacy-policy"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Privacy Policy
            </Link>
            ,{" "}
            <Link
              href="/legal/dpa"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Data Processing Addendum
            </Link>
            , and{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Sub-Processors
            </Link>{" "}
            list. Individuals on the Try Relay personal tier are governed by the{" "}
            <Link
              href="/legal/terms-consumer"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Terms (Consumer)
            </Link>{" "}
            instead.
          </p>

          <div style={footerLineStyle}>
            Questions?{" "}
            <a
              href="mailto:support@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              support@relay.green
            </a>
            .
          </div>
        </div>
      </section>
    </Shell>
  );
}
