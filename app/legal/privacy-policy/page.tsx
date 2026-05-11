/*
 * /legal/privacy-policy — Relay's privacy policy. DRAFT.
 *
 * Server component. Prose lifted from the section-10 working draft in the
 * sitemap-and-content-plan content.html. Counsel review pending.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Relay — Privacy Policy",
  description:
    "What we collect, what we don't, how we use it, and where we store it. Plain English. DRAFT — under counsel review.",
};

const draftBannerStyle = {
  background: "#fbeae5",
  border: "1px solid #e8b4a3",
  color: "#7a2810",
  padding: "14px 20px",
  borderRadius: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.06em",
  marginBottom: 24,
  textTransform: "uppercase" as const,
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

export default function PrivacyPolicyPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">— Legal · Privacy Policy</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Privacy Policy.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: May 2026 · DRAFT
          </p>
        </div>
      </section>

      <section className="r-section" style={{ paddingTop: 0, borderTop: "none" }}>
        <div className="r-wrap-narrow">
          <div style={draftBannerStyle}>
            Draft — under counsel review. Not for publication.
          </div>

          <h3 style={h3Style}>What we collect</h3>
          <h4 style={h4Style}>Account, telemetry, logs, cookies</h4>
          <p className="r-body" style={bodyStyle}>
            Account information you give us (name, email, billing). Session
            telemetry produced when you press for an engineer (the AI tool, the
            project metadata your tool exposes, the diff and conversation
            handed off, the duration and outcome). Operational logs needed to
            run the service (auth events, billing events, support tickets).
            Cookies as listed in our{" "}
            <Link
              href="/legal/cookies"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Cookie Notice
            </Link>
            .
          </p>

          <h3 style={h3Style}>What we don&rsquo;t collect</h3>
          <p className="r-body" style={bodyStyle}>
            We do not train models on customer code. We do not sell personal
            information. We do not track you across the web. We do not retain
            raw session diffs for longer than 90 days unless you ask us to.
          </p>

          <h3 style={h3Style}>How we use it</h3>
          <p className="r-body" style={bodyStyle}>
            To run the service you signed up for; to staff the bench in the
            regions you build from; to bill you; to investigate abuse and
            security incidents; to improve our own internal classifiers, in
            aggregated and anonymized form only.
          </p>

          <h3 style={h3Style}>Who we share it with</h3>
          <p className="r-body" style={bodyStyle}>
            The Relay engineer assigned to your session, for the duration of
            the session and any agreed retainer. Sub-processors listed at{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              /trust/subprocessors
            </Link>{" "}
            (cloud, email, billing, observability). Authorities, when compelled
            by valid legal process and within the limits of applicable law.
          </p>

          <h3 style={h3Style}>Where we store it</h3>
          <p className="r-body" style={bodyStyle}>
            Primary data residency in the region you select at signup (US, EU,
            UK, IN, AU). Cross-border transfers governed by Standard
            Contractual Clauses where applicable; UK Addendum for UK customers;
            India DPDP-aligned handling for India residents. See our{" "}
            <Link
              href="/legal/dpa"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Data Processing Addendum
            </Link>{" "}
            for the controller/processor terms.
          </p>

          <h3 style={h3Style}>Your rights</h3>
          <p className="r-body" style={bodyStyle}>
            Access, correction, deletion, portability, restriction, objection,
            withdrawal of consent. Where you live determines exactly how, but
            every customer has all of these. We respond to a request within
            30 days.
          </p>

          <h3 style={h3Style}>Children</h3>
          <p className="r-body" style={bodyStyle}>
            The service is not directed to anyone under 16.
          </p>

          <h3 style={h3Style}>Changes</h3>
          <p className="r-body" style={bodyStyle}>
            We will email you 30 days before any material change.
          </p>

          <div style={footerLineStyle}>
            Questions?{" "}
            <a
              href="mailto:legal@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              legal@relay.green
            </a>
            . Related policies:{" "}
            <Link
              href="/legal/terms-commercial"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Terms (Commercial)
            </Link>
            ,{" "}
            <Link
              href="/legal/cookies"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Cookies
            </Link>
            ,{" "}
            <Link
              href="/legal/dpa"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              DPA
            </Link>
            .
          </div>
        </div>
      </section>
    </Shell>
  );
}
