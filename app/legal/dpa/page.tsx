/*
 * /legal/dpa, Data Processing Addendum.
 *
 * Standard DPA reference page; the executable PDF version is exchanged
 * during contracting. Sub-processors live at /trust/subprocessors.
 * `robots: { index: false }` keeps this page out of public search
 * results — it's a destination for procurement teams, not crawlers.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Data Processing Addendum",
  description:
    "Standard DPA, EEA SCCs (Module 2), UK Addendum, India DPDP-aligned clauses. Updated quarterly.",
  alternates: { canonical: "/legal/dpa" },
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

export default function DpaPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Data Processing Addendum</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Data Processing Addendum.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: June 2026. Updated quarterly.
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{ paddingTop: 0, borderTop: "none" }}
      >
        <div className="r-wrap-narrow">
          <h3 style={h3Style}>Overview</h3>
          <p className="r-body" style={bodyStyle}>
            Standard Data Processing Addendum. EEA SCCs (Module 2) annexed. UK
            Addendum annexed. India DPDP-compliant clauses annexed.
            Sub-processor list at{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              /trust/subprocessors
            </Link>
            . Updated quarterly.
          </p>

          <h3 style={h3Style}>What this addendum covers</h3>
          <h4 style={h4Style}>Roles</h4>
          <p className="r-body" style={bodyStyle}>
            For most data flows, the Customer is the Controller and Relay is the
            Processor. For Relay&rsquo;s own account and billing information,
            Relay is the Controller. Roles per data category are defined in
            Annex I.
          </p>

          <h4 style={h4Style}>International transfers</h4>
          <p className="r-body" style={bodyStyle}>
            EEA transfers rely on the European Commission&rsquo;s Standard
            Contractual Clauses (Module 2, controller to processor),
            incorporated by reference. UK transfers rely on the UK International
            Data Transfer Addendum to the SCCs. India residents are handled
            under the Digital Personal Data Protection Act (DPDP) framework,
            with notice, consent, and grievance officer mechanisms documented in
            Annex III.
          </p>

          <h4 style={h4Style}>Sub-processors</h4>
          <p className="r-body" style={bodyStyle}>
            We maintain a current, dated list of sub-processors at{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              /trust/subprocessors
            </Link>
            . Customers may subscribe to email notifications of changes; we give
            30 days&rsquo; notice before adding a new sub-processor.
          </p>

          <h4 style={h4Style}>Security</h4>
          <p className="r-body" style={bodyStyle}>
            Technical and organisational measures are described in Annex II and
            align with the security posture published at the{" "}
            <Link
              href="/trust"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Trust center
            </Link>
            .
          </p>

          <h4 style={h4Style}>Audits and assurance</h4>
          <p className="r-body" style={bodyStyle}>
            Customers may exercise audit rights through our SOC 2 Type II report
            (under NDA) and an annual questionnaire. On-site audit rights are
            available to Enterprise customers under the order form.
          </p>

          <h3 style={h3Style}>Executing this DPA</h3>
          <p className="r-body" style={bodyStyle}>
            For most customers the DPA is incorporated by reference into your
            order form and requires no separate signature. For customers who
            need a counter-signed copy, contact{" "}
            <Link
              href="/company/about#contact"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              /company/about#contact
            </Link>{" "}
            and we&rsquo;ll route it through our legal team.
          </p>

          <div style={footerLineStyle}>
            Questions?{" "}
            <a
              href="mailto:support@relay.green"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              support@relay.green
            </a>
            . Related:{" "}
            <Link
              href="/legal/privacy-policy"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Privacy Policy
            </Link>
            ,{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Sub-Processors
            </Link>
            ,{" "}
            <Link
              href="/legal/terms-commercial"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Terms (Commercial)
            </Link>
            .
          </div>
        </div>
      </section>
    </Shell>
  );
}
