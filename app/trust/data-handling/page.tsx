/*
 * /trust/data-handling, Lifecycle of session data.
 *
 * Capture → Retention → Anonymization → Deletion. Region map. The
 * 90-day default retention and how to change it. The "we don't train
 * on your code" commitment, in writing.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Data handling",
  description:
    "Lifecycle of session data, capture, retention, anonymization, deletion. Region map and the 90-day default.",
  alternates: { canonical: "/trust/data-handling" },
};

const STAGES = [
  {
    num: "01",
    title: "Capture",
    body: "Only what the session needs. Chat is captured by default. Voice is captured as audio; transcripts are derived on request and stored separately. Screen-share is captured only when the customer turns on recording, never on by default. Customer code shared in-session is captured to the session transcript and never to a separate corpus.",
  },
  {
    num: "02",
    title: "Retention",
    body: "Ninety days, by default. After ninety days, transcripts and recordings are erased from primary storage and removed from backups within the next backup rotation. Enterprise customers can configure retention from 7 days up to 7 years per workspace, or set legal-hold on a per-session basis.",
  },
  {
    num: "03",
    title: "Anonymization",
    body: "When session data is used for internal quality review, it is anonymized first, customer identifiers, code repository names, and personal data are stripped before any human reviewer sees the content. Anonymized samples never leave the Relay environment and are not used to train any model.",
  },
  {
    num: "04",
    title: "Deletion",
    body: "Customer-initiated deletion is honored within seven days for primary stores and within thirty days for backups. A signed deletion certificate is issued on request. Engineering accounts that lose access to a tenant lose access to the tenant's session data within minutes, not days.",
  },
];

const REGIONS = [
  "United States, AWS us-east-1 (N. Virginia), us-west-2 (Oregon)",
  "European Union, AWS eu-central-1 (Frankfurt), eu-west-1 (Ireland)",
  "United Kingdom, AWS eu-west-2 (London)",
  "India, AWS ap-south-1 (Mumbai) for India-resident handling",
  "Asia Pacific, AWS ap-southeast-1 (Singapore), ap-northeast-1 (Tokyo)",
  "Australia, AWS ap-southeast-2 (Sydney)",
];

export default function TrustDataHandlingPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Trust · Data handling</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            The lifecycle of <em>a session.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            Four stages, in order, from the moment a press connects through to
            the moment the data is gone. Plus the region map, the retention
            default, and the one commitment that doesn&rsquo;t bend.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          {STAGES.map((s, i) => (
            <div
              key={s.num}
              style={{
                padding: "28px 0",
                borderTop: i === 0 ? "1px solid #d2d2d7" : "none",
                borderBottom: "1px solid #d2d2d7",
              }}
            >
              <div className="r-num" style={{ marginBottom: 12 }}>
                , {s.num}
              </div>
              <h3 className="r-h-2" style={{ marginBottom: 14 }}>
                {s.title}
              </h3>
              <p className="r-body">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">Region map.</h2>
          <p className="r-body" style={{ marginBottom: 24 }}>
            Customers choose where session data lives at workspace creation.
            Enterprise plans can pin specific data classes to specific regions.
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              border: "1px solid var(--rule)",
              borderRadius: 8,
              background: "var(--paper)",
              boxShadow: "0 22px 54px rgba(0, 0, 0, 0.05)",
            }}
          >
            {REGIONS.map((r, i) => (
              <li
                key={i}
                style={{
                  padding: "16px 20px",
                  borderBottom:
                    i === REGIONS.length - 1 ? "none" : "1px solid #d2d2d7",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                <span style={{ color: "var(--green)", marginRight: 10 }}>
                  ·
                </span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-2">90 days. Change it any time.</h2>
          <p className="r-body" style={{ marginBottom: 16 }}>
            The default retention is ninety days because most teams need to
            re-watch a session within the first quarter and rarely after. To
            change it:{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5 }}>
              Workspace → Settings → Data → Retention.
            </span>
          </p>
          <p className="r-body">
            Set it to 7, 30, 90, 180, 365 days, or a custom value up to 7 years.
            Enterprise plans support per-session legal hold.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div
            className="r-tile"
            style={{
              background: "var(--ink)",
              color: "var(--cream)",
              padding: "40px 36px",
              border: "1px solid var(--ink)",
              minHeight: 0,
            }}
          >
            <div
              className="r-num"
              style={{ color: "rgba(244,242,238,0.5)", marginBottom: 16 }}
            >
              The commitment
            </div>
            <h3
              className="r-h-2"
              style={{ color: "var(--cream)", marginBottom: 16 }}
            >
              We don&rsquo;t train on{" "}
              <em style={{ color: "var(--green-bright)" }}>your code.</em>
            </h3>
            <p
              style={{
                color: "rgba(244,242,238,0.85)",
                fontSize: 17,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              Customer code, prompts, transcripts, and session recordings are
              never used to train a foundation model, not ours, not a
              vendor&rsquo;s, not under any plan, not under any agreement
              negotiated separately. This is in the master subscription
              agreement and it does not get redlined.
            </p>
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
