/*
 * /trust/security, Defense-in-depth narrative.
 *
 * Four layered postures: identity, data, platform, people. Plain prose,
 * no certifications-as-marketing. Each layer answers a single question:
 * what stops the wrong person, the wrong machine, or the wrong process.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Defense-in-depth across identity, data, platform, and people. How Relay secures every press.",
  alternates: { canonical: "/trust/security" },
  robots: { index: false, follow: false },
};

const LAYERS = [
  {
    num: "01",
    title: "Identity",
    body: "SSO via SAML and OIDC for customer accounts. SCIM provisioning for Enterprise. Hardware-key MFA is mandatory for every Relay engineer who can join a session, no exceptions, no SMS fallback. Customer access is scoped to the tenant; engineer access is scoped to the active session and revoked when the session ends.",
  },
  {
    num: "02",
    title: "Data",
    body: "Encryption at rest with AES-256 and in transit with TLS 1.3. Per-tenant logical isolation across application data, session transcripts, and screen-share recordings. Customer code and prompts are never used to train a foundation model, not ours, not a vendor's. Backups are encrypted, region-bound, and tested quarterly.",
  },
  {
    num: "03",
    title: "Platform",
    body: "Least-privilege IAM by default. Production access requires hardware MFA plus a just-in-time approval window; standing admin credentials do not exist. Infrastructure as code, signed commits, mandatory peer review on production changes. Continuous vulnerability scanning across containers, dependencies, and infrastructure.",
  },
  {
    num: "04",
    title: "People",
    body: "Background checks on every engineer before bench placement. Signed code of conduct and confidentiality agreement. Annual security training, tracked. Quarterly tabletop exercises for incident response. Engineers are paid by a Relay-controlled entity under a unified employment standard, we do not contract through marketplaces, and we do not aggregate freelancers.",
  },
];

export default function TrustSecurityPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">Trust · Security</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Defense in depth, <em>by layer.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 24 }}>
            Four answers to four questions: who is allowed in, what protects the
            data once they are, what stops the platform from being a single
            point of failure, and which humans we trust enough to put behind the
            dot.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          {LAYERS.map((l, i) => (
            <div
              key={l.num}
              style={{
                paddingBottom: 40,
                marginBottom: 40,
                borderBottom:
                  i === LAYERS.length - 1 ? "none" : "1px solid var(--rule)",
              }}
            >
              <div className="r-num" style={{ marginBottom: 12 }}>
                , {l.num}
              </div>
              <h3 className="r-h-2" style={{ marginBottom: 16 }}>
                {l.title}
              </h3>
              <p className="r-body">{l.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <p className="r-body" style={{ marginBottom: 24 }}>
            Auditor reports, including SOC 2 Type II once issued, are available
            to enterprise prospects under NDA.{" "}
            <Link
              href="/company/about#contact"
              style={{
                borderBottom: "1px solid var(--ink)",
                color: "var(--ink)",
              }}
            >
              Request the report
            </Link>
            .
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
