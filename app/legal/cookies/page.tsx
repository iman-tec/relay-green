/*
 * /legal/cookies, Cookie Notice. DRAFT.
 *
 * Four-category table (strictly necessary, functional, analytics, marketing).
 * Live source for the table will eventually be /trust/data-handling.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";

export const metadata: Metadata = {
  title: "Cookie Notice",
  description:
    "What cookies relay.green uses, why, and for how long. Four categories, plain table.",
  alternates: { canonical: "/legal/cookies" },
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

const tableStyle = {
  width: "100%",
  borderCollapse: "separate" as const,
  borderSpacing: 0,
  marginTop: 24,
  marginBottom: 28,
  fontSize: 14,
  background: "#ffffff",
  border: "1px solid #d2d2d7",
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "0 22px 54px rgba(0, 0, 0, 0.05)",
};

const thStyle = {
  textAlign: "left" as const,
  padding: "15px 18px",
  borderBottom: "1px solid #d2d2d7",
  background: "#f5f5f7",
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "#6e6e73",
};

const tdStyle = {
  padding: "18px",
  borderBottom: "1px solid #d2d2d7",
  background: "#ffffff",
  verticalAlign: "top" as const,
  lineHeight: 1.55,
  color: "#424245",
};

const categoryRowStyle = {
  ...tdStyle,
  fontFamily: "var(--font-display)",
  fontSize: 16,
  color: "var(--ink)",
};

type Row = {
  category: string;
  purpose: string;
  vendor: string;
  retention: string;
};

const rows: Row[] = [
  {
    category: "Strictly necessary",
    purpose: "Session authentication, CSRF protection.",
    vendor: "Relay (first-party)",
    retention: "Session",
  },
  {
    category: "Strictly necessary",
    purpose: "Load balancing across regions.",
    vendor: "Relay (first-party)",
    retention: "1 hour",
  },
  {
    category: "Functional",
    purpose: "Remember your selected region and locale.",
    vendor: "Relay (first-party)",
    retention: "12 months",
  },
  {
    category: "Functional",
    purpose: "Saved press settings (default modality).",
    vendor: "Relay (first-party)",
    retention: "12 months",
  },
  {
    category: "Analytics",
    purpose:
      "Aggregated, IP-truncated page-view counts to size the bench by region.",
    vendor: "Plausible Analytics",
    retention: "Sessionised; no individual identifier stored",
  },
  {
    category: "Analytics",
    purpose: "Anonymous performance and error telemetry.",
    vendor: "Sentry",
    retention: "30 days",
  },
  {
    category: "Marketing",
    purpose: "Attribution for paid campaigns, only set after explicit consent.",
    vendor: "Relay (first-party) + LinkedIn Insight Tag",
    retention: "90 days",
  },
  {
    category: "Marketing",
    purpose: "A/B test assignment for landing-page experiments (consented).",
    vendor: "Relay (first-party)",
    retention: "30 days",
  },
];

export default function CookiesPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Legal · Cookie Notice</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            <em>Cookie Notice.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Last updated: May 2026
          </p>
        </div>
      </section>

      <section
        className="r-section"
        style={{ paddingTop: 0, borderTop: "none", background: "#f5f5f7" }}
      >
        <div className="r-wrap-narrow">
          <p className="r-body" style={bodyStyle}>
            Cookies and similar storage technologies let relay.green keep you
            signed in, remember your settings, and understand whether the site
            is working. We group them into four categories, listed below. You
            can withdraw consent for analytics and marketing categories from
            your account preferences at any time. Strictly necessary and
            functional cookies are required for the service to operate.
          </p>

          <h3 style={h3Style}>The four categories</h3>

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Purpose</th>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Retention</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={categoryRowStyle}>{r.category}</td>
                  <td style={tdStyle}>{r.purpose}</td>
                  <td style={tdStyle}>{r.vendor}</td>
                  <td style={tdStyle}>{r.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="r-body" style={bodyStyle}>
            The trust center keeps the operational record behind this notice,
            including the current sub-processor list. See{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid currentColor" }}
            >
              /trust/subprocessors
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
            . Related:{" "}
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
