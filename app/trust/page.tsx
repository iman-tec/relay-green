/*
 * /trust, Trust center index.
 *
 * Quiet posture page. Four cards link to the current trust/legal surfaces, plus a
 * dark-ink state-of-compliance tile listing every framework's status.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";
import { TryRelayButton } from "../_marketing/TryRelayButton";
import { JsonLd } from "../_marketing/JsonLd";
import { faqSchema } from "../../lib/seo/schema";

export const metadata: Metadata = {
  title: "Trust center",
  description:
    "Press once. The receipts are already filed. Privacy, compliance, data-handling, and sub-processor posture for Relay.",
  alternates: { canonical: "/trust" },
};

const SECTIONS = [
  {
    num: "01",
    href: "/trust/privacy",
    title: "Privacy",
    body: "Plain-language companion to the legal Privacy Policy. What we collect, how we use it, and how to reach us.",
  },
  {
    num: "02",
    href: "/trust/compliance",
    title: "Compliance",
    body: "Current framework posture across GDPR, HIPAA, ISO 27001, DPDP, CCPA, and SOC 2 readiness.",
  },
  {
    num: "03",
    href: "/trust/data-handling",
    title: "Data handling",
    body: "Lifecycle of session data, capture, retention, anonymization, deletion.",
  },
  {
    num: "04",
    href: "/trust/subprocessors",
    title: "Sub-processors",
    body: "Every vendor that touches customer data, with purpose, region, and role.",
  },
];

const TRUST_FAQ = [
  {
    q: "Where is customer data stored?",
    a: "Production data lives in AWS, in the region you select at signup, US, EU, UK, India, or Australia. Backups stay region-bound and encrypted. The full region map is in /trust/data-handling.",
  },
  {
    q: "Do you train AI models on customer code or prompts?",
    a: "No. Customer code, prompts, screen-share, and session transcripts are never used to train a foundation model, not ours, not a vendor's. The commitment is in /trust/data-handling.",
  },
  {
    q: "What's your SOC 2 status?",
    a: "SOC 2 readiness work is in progress. Live status is at /trust/compliance. Auditor reports, once issued, are available under NDA through support@relay.green.",
  },
  {
    q: "How do you handle sub-processor changes?",
    a: "Every sub-processor is listed at /trust/subprocessors with purpose, region, and role. Material changes are announced before they go live; subscribe via support@relay.green.",
  },
  {
    q: "Can a Relay engineer see my code without my consent?",
    a: "No. The engineer joins what you put on the screen share or paste into chat. We don't ingest your repo, your editor history, or your AI tool's context unless you share it during the session.",
  },
];

const COMPLIANCE = [
  { name: "SOC 2 Type II", status: "In progress · audit window opened" },
  {
    name: "GDPR",
    status: "In place · EU posture across data processing, consent, and rights",
  },
  { name: "HIPAA", status: "BAA available on Enterprise" },
  { name: "ISO 27001", status: "Planned · post Series A" },
  {
    name: "DPDP (India)",
    status: "India-resident handling for India customers",
  },
];

export default function TrustIndex() {
  return (
    <Shell>
      <JsonLd
        data={faqSchema(TRUST_FAQ.map((f) => ({ question: f.q, answer: f.a })))}
      />

      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Trust · Index</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Press once. <em>The receipts</em>
            <br />
            are already filed.
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            A quiet posture page. The work behind the press button, how it is
            governed, how data is handled, which frameworks apply, and who we
            rely on is documented here, in plain language, and kept current.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div
            className="r-grid-collapse-md"
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
                  background: "var(--paper)",
                  padding: "32px 28px",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 200,
                  transition: "background 0.18s ease",
                }}
              >
                <div className="r-num" style={{ marginBottom: 16 }}>
                  , {s.num}
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
              State of compliance · June 2026
            </div>
            <h3
              className="r-h-2"
              style={{ color: "var(--cream)", marginBottom: 24 }}
            >
              Where every framework{" "}
              <em style={{ color: "var(--green-bright)" }}>stands today.</em>
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
                  className="r-grid-collapse-md"
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
        <div className="r-wrap-narrow">
          <h2 className="r-h-2" style={{ marginBottom: 32 }}>
            Frequently asked
          </h2>
          <dl style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {TRUST_FAQ.map((item) => (
              <div key={item.q}>
                <dt className="r-h-3" style={{ marginBottom: 8, fontSize: 20 }}>
                  {item.q}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    color: "var(--ink-soft)",
                    lineHeight: 1.6,
                  }}
                >
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2" style={{ marginBottom: 24 }}>
            Further reading
          </h2>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              borderTop: "1px solid var(--rule)",
            }}
          >
            <li
              style={{
                borderBottom: "1px solid var(--rule)",
                padding: "20px 0",
              }}
            >
              <Link
                href="/resources/white-papers/compliance-architecture-for-ai-built-software"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <span className="r-num">White paper</span>
                <span
                  className="r-h-3"
                  style={{ fontSize: 22, marginBottom: 4 }}
                >
                  Compliance architecture for AI-built software
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--ink-soft)",
                    lineHeight: 1.55,
                  }}
                >
                  Audit trails, the sessioned record, and what SOC 2 + ISO 27001
                  actually require when most of the code in your company isn’t
                  written by your engineers.
                </span>
              </Link>
            </li>
            <li
              style={{
                borderBottom: "1px solid var(--rule)",
                padding: "20px 0",
              }}
            >
              <Link
                href="/resources/white-papers/hipaa-and-the-press"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <span className="r-num">White paper</span>
                <span
                  className="r-h-3"
                  style={{ fontSize: 22, marginBottom: 4 }}
                >
                  HIPAA and the press: training a bench for PHI
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--ink-soft)",
                    lineHeight: 1.55,
                  }}
                >
                  How we train, segment, and govern a bench of engineers
                  to handle protected health information at the moment a builder
                  presses for help.
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow" style={{ textAlign: "center" }}>
          <p className="r-small" style={{ marginBottom: 24 }}>
            Last updated: June 2026
          </p>
          <TryRelayButton />
        </div>
      </section>
    </Shell>
  );
}
