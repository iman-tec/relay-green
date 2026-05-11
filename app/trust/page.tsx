/*
 * /trust — Trust center index.
 *
 * Quiet posture page. Six cards link to each sub-section, plus a
 * dark-ink state-of-compliance tile listing every framework's status.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";
import { TryRelayButton } from "../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — Trust center",
  description:
    "Press once. The receipts are already filed. Security, privacy, compliance, and data-handling posture for Relay.",
};

const SECTIONS = [
  {
    num: "01",
    href: "/trust/security",
    title: "Security",
    body: "Defense-in-depth across identity, data, platform, and people.",
  },
  {
    num: "02",
    href: "/trust/privacy",
    title: "Privacy",
    body: "Plain-language companion to the legal Privacy Policy. Customer rights, exercised in one click.",
  },
  {
    num: "03",
    href: "/trust/compliance",
    title: "Compliance",
    body: "Live status of every framework. SOC 2, GDPR, HIPAA, ISO 27001, DPDP, CCPA.",
  },
  {
    num: "04",
    href: "/trust/data-handling",
    title: "Data handling",
    body: "Lifecycle of session data — capture, retention, anonymization, deletion.",
  },
  {
    num: "05",
    href: "/trust/subprocessors",
    title: "Sub-processors",
    body: "Every vendor that touches customer data, with purpose, region, and DPA link.",
  },
  {
    num: "06",
    href: "/trust/responsible-disclosure",
    title: "Responsible disclosure",
    body: "How to report a vulnerability. Safe harbor, contact, response SLA.",
  },
];

const COMPLIANCE = [
  { name: "SOC 2 Type II", status: "In progress · audit window opened" },
  { name: "GDPR", status: "In place · EU posture across data, DPAs, and rights" },
  { name: "HIPAA", status: "BAA available on Enterprise" },
  { name: "ISO 27001", status: "Planned · post Series A" },
  { name: "DPDP (India)", status: "India-resident handling for India customers" },
];

export default function TrustIndex() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">— Trust · Index</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Press once. <em>The receipts</em>
            <br />
            are already filed.
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            A quiet posture page. The work behind the press button — how it is
            secured, how data is handled, which frameworks govern us, and who we
            rely on — is documented here, in plain language, and kept current.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div
            className="r-grid-2"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 1,
              background: "var(--rule)",
              border: "1px solid var(--rule)",
            }}
          >
            {SECTIONS.map((s) => (
              <Link
                href={s.href}
                key={s.num}
                style={{
                  background: "var(--cream)",
                  padding: "32px 28px",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 200,
                  transition: "background 0.18s ease",
                }}
              >
                <div className="r-num" style={{ marginBottom: 16 }}>
                  — {s.num}
                </div>
                <h3 className="r-h-3" style={{ marginBottom: 8 }}>
                  {s.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "var(--ink-soft)",
                    flex: 1,
                  }}
                >
                  {s.body}
                </p>
                <div
                  style={{
                    marginTop: 18,
                    fontSize: 13,
                    color: "var(--green)",
                    fontWeight: 500,
                  }}
                >
                  Read more →
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div
            className="r-tile"
            style={{
              background: "var(--ink)",
              color: "var(--cream)",
              padding: "44px 40px",
              border: "1px solid var(--ink)",
              minHeight: 0,
            }}
          >
            <div
              className="r-num"
              style={{ color: "rgba(244,242,238,0.5)", marginBottom: 18 }}
            >
              — State of compliance · May 2026
            </div>
            <h3
              className="r-h-2"
              style={{ color: "var(--cream)", marginBottom: 24 }}
            >
              Where every framework <em style={{ color: "var(--green-bright)" }}>stands today.</em>
            </h3>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {COMPLIANCE.map((c) => (
                <li
                  key={c.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "200px 1fr",
                    gap: 18,
                    paddingBottom: 14,
                    borderBottom: "1px solid rgba(244,242,238,0.12)",
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: "var(--cream)", fontWeight: 500 }}>
                    {c.name}
                  </span>
                  <span style={{ color: "rgba(244,242,238,0.78)" }}>
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow" style={{ textAlign: "center" }}>
          <p className="r-small" style={{ marginBottom: 24 }}>
            Last updated: May 2026
          </p>
          <TryRelayButton />
        </div>
      </section>
    </Shell>
  );
}
