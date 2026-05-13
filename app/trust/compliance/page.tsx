/*
 * /trust/compliance — Live status of every framework Relay operates under.
 *
 * Single table, six rows. Auditor reports gated behind NDA; the request
 * link routes through /company/contact.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — Compliance",
  description:
    "Live status of every framework Relay operates under. SOC 2 Type II, GDPR, HIPAA, ISO 27001, DPDP, CCPA.",
};

const ROWS = [
  {
    framework: "SOC 2 Type II",
    status: "In progress",
    period: "Audit window: Apr 2026 – Sep 2026",
    detail: "Trust Services Criteria: Security, Availability, Confidentiality. Type I attestation issued; Type II report on completion of the observation window.",
  },
  {
    framework: "GDPR",
    status: "In place",
    period: "Continuous",
    detail: "EU data residency option. Standard Contractual Clauses on every transfer. DPAs available on request. Data Protection Officer: support@relay.green.",
  },
  {
    framework: "HIPAA",
    status: "BAA available · Enterprise",
    period: "Continuous",
    detail: "Business Associate Agreement available on Enterprise plans. Administrative, physical, and technical safeguards mapped to 45 CFR §164.",
  },
  {
    framework: "ISO 27001",
    status: "Planned",
    period: "Target: post Series A",
    detail: "Information Security Management System scoped. External certification body to be selected after Series A close.",
  },
  {
    framework: "DPDP (India)",
    status: "In place",
    period: "Continuous",
    detail: "India-resident handling for India customers. Notice and consent flows aligned to the Digital Personal Data Protection Act, 2023.",
  },
  {
    framework: "CCPA / CPRA",
    status: "In place",
    period: "Continuous",
    detail: "California consumer rights honored across all plans. Do Not Sell or Share signal respected. Annual training for personnel handling consumer data.",
  },
];

const STATUS_COLOR: Record<string, string> = {
  "In place": "var(--green)",
  "In progress": "var(--clay)",
  "Planned": "var(--ink-soft)",
  "BAA available · Enterprise": "var(--green)",
};

export default function TrustCompliancePage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">— Trust · Compliance</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Frameworks, <em>live status.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            One table, kept current. Where we are with every framework that
            governs how Relay handles customer data — what it covers, what
            window it applies to, and where to read further.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div
            style={{
              border: "1px solid var(--rule)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              background: "var(--cream)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1.2fr 2.2fr",
                gap: 0,
                background: "var(--paper)",
                borderBottom: "1px solid var(--rule)",
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--ink-soft)",
                fontWeight: 500,
              }}
            >
              <div style={{ padding: "14px 18px" }}>Framework</div>
              <div style={{ padding: "14px 18px" }}>Status</div>
              <div style={{ padding: "14px 18px" }}>Period</div>
              <div style={{ padding: "14px 18px" }}>Detail</div>
            </div>
            {ROWS.map((r, i) => (
              <div
                key={r.framework}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1.2fr 2.2fr",
                  gap: 0,
                  borderBottom:
                    i === ROWS.length - 1 ? "none" : "1px solid var(--rule)",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                }}
              >
                <div
                  style={{
                    padding: "20px 18px",
                    fontFamily: "var(--font-display)",
                    fontSize: 17,
                    color: "var(--ink)",
                  }}
                >
                  {r.framework}
                </div>
                <div style={{ padding: "20px 18px" }}>
                  <span
                    style={{
                      color: STATUS_COLOR[r.status] ?? "var(--ink)",
                      fontWeight: 500,
                    }}
                  >
                    {r.status}
                  </span>
                </div>
                <div
                  style={{
                    padding: "20px 18px",
                    color: "var(--ink-soft)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                  }}
                >
                  {r.period}
                </div>
                <div
                  style={{ padding: "20px 18px", color: "var(--ink-2)" }}
                >
                  {r.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Auditor reports.</h2>
          <p className="r-body" style={{ marginBottom: 24 }}>
            Full attestation reports — including SOC 2 Type II once issued —
            are available to enterprise prospects under NDA. Send the request
            and we will route it to the security team.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/company/contact" className="r-btn r-btn-ink">
              Request a report <span className="arrow">→</span>
            </Link>
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
