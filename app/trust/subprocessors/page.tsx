/*
 * /trust/subprocessors, Sub-processor table.
 *
 * Every vendor that touches customer data, with purpose and region.
 * Updated quarterly; the date is shown at the top of the table.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Sub-processors",
  description:
    "Every vendor that touches customer data at Relay, with purpose and region. Updated quarterly.",
  alternates: { canonical: "/trust/subprocessors" },
};

const ROWS = [
  {
    vendor: "Amazon Web Services",
    purpose: "Cloud infrastructure, compute, storage, encryption",
    region: "US, EU (per workspace)",
  },
  {
    vendor: "Stripe",
    purpose: "Billing and payment processing",
    region: "US",
  },
  {
    vendor: "Vercel",
    purpose: "Application hosting and edge delivery",
    region: "US",
  },
  {
    vendor: "Datadog",
    purpose: "Observability, metrics, traces, infrastructure logs",
    region: "US",
  },
  {
    vendor: "Postmark",
    purpose: "Transactional email delivery",
    region: "US",
  },
  {
    vendor: "Cloudflare",
    purpose: "Edge network, DDoS protection, CDN",
    region: "Global",
  },
];

export default function TrustSubprocessorsPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Trust · Sub-processors</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Every vendor that <em>touches your data.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            Six entries. Each with a purpose and a region. Material
            sub-processor changes are announced before they go live; this page
            is the canonical record.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <p
            className="r-small"
            style={{
              marginBottom: 18,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            Last reviewed: May 2026 · updated quarterly
          </p>
          {/* Wrapped in r-grid-table-scroll so the dense vendor
              matrix scrolls horizontally on phones rather than squeezing. */}
          <div className="r-grid-table-scroll">
            <div
              style={{
                border: "1px solid #d2d2d7",
                borderRadius: 8,
                overflow: "hidden",
                background: "#ffffff",
                minWidth: 640,
                boxShadow: "0 22px 54px rgba(0, 0, 0, 0.05)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 2.4fr 1.2fr",
                  gap: 0,
                  background: "#f5f5f7",
                  borderBottom: "1px solid #d2d2d7",
                  fontFamily: "var(--font-sans)",
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--ink-soft)",
                  fontWeight: 500,
                }}
              >
                <div style={{ padding: "14px 18px" }}>Vendor</div>
                <div style={{ padding: "14px 18px" }}>Purpose</div>
                <div style={{ padding: "14px 18px" }}>Region</div>
              </div>
              {ROWS.map((r, i) => (
                <div
                  key={r.vendor}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 2.4fr 1.2fr",
                    gap: 0,
                    borderBottom:
                      i === ROWS.length - 1 ? "none" : "1px solid #d2d2d7",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      padding: "20px 18px",
                      fontFamily: "var(--font-display)",
                      fontSize: 18,
                      color: "var(--ink)",
                    }}
                  >
                    {r.vendor}
                  </div>
                  <div style={{ padding: "20px 18px", color: "var(--ink-2)" }}>
                    {r.purpose}
                  </div>
                  <div
                    style={{
                      padding: "20px 18px",
                      color: "var(--ink-soft)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                    }}
                  >
                    {r.region}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <p className="r-body" style={{ marginBottom: 24 }}>
            Subscribe to sub-processor updates by writing to{" "}
            <a
              href="mailto:support@relay.green"
              style={{ borderBottom: "1px solid var(--ink)" }}
            >
              support@relay.green
            </a>
            . Enterprise customers receive a thirty-day notice before any new
            sub-processor begins handling their data.
          </p>
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
