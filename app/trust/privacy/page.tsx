/*
 * /trust/privacy, Plain-language companion to the legal Privacy Policy.
 *
 * Where data lives (text-only diagram), the four customer rights, and
 * self-serve buttons. The legal document is the source of truth; this
 * page exists so a human can read the posture in five minutes.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Plain-language companion to the legal Privacy Policy. Where your data lives, and how to exercise your rights in one click.",
  alternates: { canonical: "/trust/privacy" },
};

const WHERE_DATA_LIVES = [
  "Account & billing, US (AWS us-east-1), encrypted at rest",
  "Session transcripts (chat, voice metadata), region of customer choice",
  "Screen-share recordings, region of customer choice, 90-day default",
  "Code snippets shared in-session, same region as the transcript",
  "Audit logs, US, write-once, 12-month retention",
  "Marketing analytics, anonymized, no session content",
];

const RIGHTS = [
  {
    name: "Right to access",
    body: "See everything we hold about you, in a structured export.",
    cta: "Request my data",
    subject: "Privacy request: access my data",
  },
  {
    name: "Right to rectification",
    body: "Correct anything inaccurate. We confirm in writing within 30 days.",
    cta: "Correct my record",
    subject: "Privacy request: correct my record",
  },
  {
    name: "Right to deletion",
    body: "Erase your account and all session data. Subject to legal retention obligations.",
    cta: "Delete my account",
    subject: "Privacy request: delete my account",
  },
  {
    name: "Right to portability",
    body: "Take everything with you in a machine-readable format.",
    cta: "Export everything",
    subject: "Privacy request: export my data",
  },
];

export default function TrustPrivacyPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Trust · Privacy</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Your data, <em>in plain words.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            The legal Privacy Policy is the source of truth. This page exists so
            a human can read the posture in five minutes, what we hold, where it
            sits, and how to take it back.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Where your data lives.</h2>
          <p className="r-body" style={{ marginBottom: 24 }}>
            Six places. No more. If a vendor needs to see customer data, they
            are listed on the{" "}
            <Link
              href="/trust/subprocessors"
              style={{ borderBottom: "1px solid var(--ink)" }}
            >
              sub-processors
            </Link>{" "}
            page.
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              border: "1px solid var(--rule)",
              borderRadius: 8,
              background: "#ffffff",
              boxShadow: "0 22px 54px rgba(0, 0, 0, 0.05)",
            }}
          >
            {WHERE_DATA_LIVES.map((line, i) => (
              <li
                key={i}
                style={{
                  padding: "16px 20px",
                  borderBottom:
                    i === WHERE_DATA_LIVES.length - 1
                      ? "none"
                      : "1px solid #d2d2d7",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                <span style={{ color: "var(--green)", marginRight: 10 }}>
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Your rights, exercised in one click.</h2>
          <p className="r-body" style={{ marginBottom: 32 }}>
            Four buttons. Each opens a request the privacy team is obliged to
            answer within thirty days, and usually does within five.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 16,
            }}
          >
            {RIGHTS.map((r) => (
              <div
                key={r.name}
                style={{
                  padding: "24px 24px",
                  border: "1px solid #d2d2d7",
                  borderRadius: 8,
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 24,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 280 }}>
                  <h3
                    className="r-h-3"
                    style={{ marginBottom: 6, fontSize: 20 }}
                  >
                    {r.name}
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      color: "var(--ink-soft)",
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {r.body}
                  </p>
                </div>
                <a
                  href={`mailto:legal@relay.green?subject=${encodeURIComponent(
                    r.subject
                  )}`}
                  className="r-btn r-btn-ink"
                >
                  {r.cta} <span className="arrow">→</span>
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
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
