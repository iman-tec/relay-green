/*
 * /company/contact — How to reach a person at Relay.
 *
 * Two-column grid of contact lanes (sales, support, press, partnerships,
 * security disclosures, NY office, mailing address). Each block is an h4
 * with the email or address underneath.
 */

import type { Metadata } from "next";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — Contact",
  description:
    "Talk to a person at Relay. Sales, support, press, partnerships, security disclosures, and our New York office.",
};

type Channel = {
  label: string;
  primary: string;
  href?: string;
  note?: string;
};

const CHANNELS: Channel[] = [
  {
    label: "Sales",
    primary: "sales@relay.green",
    href: "mailto:sales@relay.green",
    note: "Pricing, pilots, enterprise terms.",
  },
  {
    label: "Support",
    primary: "support@relay.green",
    href: "mailto:support@relay.green",
    note: "Existing customers · in-session escalation lives in the app.",
  },
  {
    label: "Press",
    primary: "press@relay.green",
    href: "mailto:press@relay.green",
    note: "We aim to respond within one business day.",
  },
  {
    label: "Partnerships",
    primary: "partners@relay.green",
    href: "mailto:partners@relay.green",
    note: "Tool integrations, channel, and co-sell.",
  },
  {
    label: "Security disclosures",
    primary: "security@relay.green",
    href: "mailto:security@relay.green",
    note: "PGP key on request. Coordinated disclosure preferred.",
  },
  {
    label: "Investor inquiries",
    primary: "investors@relay.green",
    href: "mailto:investors@relay.green",
    note: "For Asgard LPs and prospective Series A participants.",
  },
  {
    label: "NY office",
    primary: "TBD Manhattan address",
    note: "New York, NY · By appointment only.",
  },
  {
    label: "Mailing address",
    primary: "Relay, Inc.",
    note: "New York, NY · Full address on request.",
  },
];

const cellStyle: React.CSSProperties = {
  padding: "32px 28px",
  borderRight: "1px solid var(--rule)",
  borderBottom: "1px solid var(--rule)",
  background: "var(--cream)",
  display: "flex",
  flexDirection: "column",
  minHeight: 160,
};

export default function ContactPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap-narrow">
          <span className="r-num">— Company · Contact</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            Talk to <em>a person</em>
            <br />
            at Relay.
          </h1>
          <p className="r-lede" style={{ marginTop: 28 }}>
            Pick the lane. Each one goes to a real inbox watched by a real
            human in New York, London, or Bengaluru, depending on the hour.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 0,
              borderTop: "1px solid var(--rule)",
              borderLeft: "1px solid var(--rule)",
            }}
          >
            {CHANNELS.map((c) => (
              <div key={c.label} style={cellStyle}>
                <h4
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-soft)",
                    margin: "0 0 14px",
                    fontWeight: 500,
                  }}
                >
                  {c.label}
                </h4>
                {c.href ? (
                  <a
                    href={c.href}
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 24,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                      lineHeight: 1.2,
                      borderBottom: "1px solid var(--rule)",
                      paddingBottom: 4,
                      alignSelf: "flex-start",
                    }}
                  >
                    {c.primary}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 24,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                      lineHeight: 1.2,
                    }}
                  >
                    {c.primary}
                  </span>
                )}
                {c.note && (
                  <p
                    className="r-small"
                    style={{ margin: "14px 0 0", maxWidth: "32ch" }}
                  >
                    {c.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            The fastest inbox is
            <br />
            <em>the dot itself.</em>
          </h2>
          <p className="r-lede">
            Press it. A senior engineer joins in seconds. No
            triage queue.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <TryRelayButton />
          </div>
        </div>
      </section>
    </Shell>
  );
}
