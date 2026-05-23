/*
 * /legal/sub-processors, Sub-processors index. DRAFT.
 *
 * The legal-surface stub. The trust center page at /trust/subprocessors
 * is the live source of truth (auto-updates from /trust/data-handling).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Sub-Processors",
  description:
    "Where to find Relay's live, dated list of sub-processors. The trust center is the source of truth. DRAFT, under counsel review.",
  alternates: { canonical: "/legal/sub-processors" },
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

const calloutStyle = {
  background: "#ffffff",
  border: "1px solid #d2d2d7",
  borderRadius: 8,
  padding: "24px 28px",
  marginTop: 24,
  marginBottom: 24,
  boxShadow: "0 22px 54px rgba(0, 0, 0, 0.05)",
};

export default function SubProcessorsPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Sub-Processors</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Sub-Processors.</em>
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
            Relay maintains a live, dated table of sub-processors, cloud, email,
            billing, observability, and analytics providers, with purpose and
            region per row. The trust center is the system of record.
          </p>

          <div style={calloutStyle}>
            <h3 style={{ ...h3Style, marginTop: 0 }}>
              The live list lives at the trust center
            </h3>
            <p className="r-body" style={bodyStyle}>
              Visit{" "}
              <Link
                href="/trust/subprocessors"
                style={{
                  borderBottom: "1px solid currentColor",
                  fontWeight: 500,
                }}
              >
                /trust/subprocessors
              </Link>{" "}
              for the current table and the email subscription for material
              sub-processor changes.
            </p>
          </div>

          <h3 style={h3Style}>How this connects to the rest of legal</h3>
          <p className="r-body" style={bodyStyle}>
            The sub-processor list is referenced by our{" "}
            <Link
              href="/legal/privacy-policy"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Privacy Policy
            </Link>{" "}
            (who we share data with). Cookie vendors are listed separately in
            the{" "}
            <Link
              href="/legal/cookies"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              Cookie Notice
            </Link>
            .
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
