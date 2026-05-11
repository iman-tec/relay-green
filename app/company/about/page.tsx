/*
 * /company/about — Who Relay is + how it's owned, funded, and run.
 *
 * Editorial structure: hero · manifesto pull-quote · three pillars (cards
 * with icons) · global reach stats · governance breakdown (compact tabular)
 * · press & investor card · CTA. The standalone /company/governance route
 * permanent-redirects here.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — About",
  description:
    "A new company built around one gesture: press for an engineer. Headquartered in Manhattan. Engineers in fifteen-plus countries. The corporate structure, funding, and operating partner — all on one page.",
};

const ICON = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PILLARS = [
  {
    num: "01",
    label: "Headquarters",
    title: "Manhattan, New York",
    body: "Relay, Inc. is a Delaware C-Corporation, headquartered in Manhattan with subsidiaries covering EU and engineering operations.",
    icon: (
      <svg {...ICON} aria-hidden="true">
        <path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ),
  },
  {
    num: "02",
    label: "Funded by",
    title: "The Asgard Fund",
    body: "Seed round led by The Asgard Fund — an early-stage venture fund based in Amsterdam. A financial investor with no operational role.",
    icon: (
      <svg {...ICON} aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M8 6V4h8v2" />
      </svg>
    ),
  },
  {
    num: "03",
    label: "Operated with",
    title: "NINtec Systems",
    body: "NSE/BSE-listed (NINSYS), part of the Gateway Group. Engineering teams across more than fifteen countries on a follow-the-sun service model.",
    icon: (
      <svg {...ICON} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    ),
  },
];

const REACH_STATS = [
  { num: "15+", label: "Countries" },
  { num: "2,000+", label: "Engineers" },
  { num: "24/7", label: "Follow-the-sun" },
  { num: "29", label: "Years of delivery" },
];

const GOVERNANCE_LEFT: { title: string; body: React.ReactNode }[] = [
  {
    title: "Corporate structure",
    body: (
      <>
        Relay, Inc. is a Delaware C-Corporation, headquartered at a TBD
        Manhattan address, New York, NY. Wholly-owned subsidiaries cover EU
        operations (Relay Europe BV, Amsterdam) and engineering operations
        (Relay Engineering Pvt. Ltd., Bengaluru, in formation). The brand and
        product surface — <em>relay.green</em> — is a property of Relay, Inc.
      </>
    ),
  },
  {
    title: "Funding",
    body: (
      <>
        Relay’s seed round is led by <em>The Asgard Fund</em>, an early-stage
        venture fund based in Amsterdam. A financial investor with no
        operational role.
      </>
    ),
  },
  {
    title: "Operating partner",
    body: (
      <>
        Engineering operations are performed by Relay’s wholly-owned
        engineering entity, with execution capacity provided by{" "}
        <em>NINtec Systems</em> — an NSE/BSE-listed software engineering
        company in the Gateway Group, with engineering teams across more than
        fifteen countries on a follow-the-sun service model.
      </>
    ),
  },
  {
    title: "The bench",
    body: (
      <>
        Every engineer who picks up a Relay press is paid by a
        Relay-controlled entity under a unified employment standard,
        regardless of which country they sit in. We do not aggregate
        freelancers. We do not contract through marketplaces.
      </>
    ),
  },
];

const GOVERNANCE_RIGHT: { title: string; body: React.ReactNode }[] = [
  {
    title: "Board",
    body: (
      <>
        Founder seat. Asgard observer. Two independent directors (to be
        announced post-Series A). NINtec representation at the operating
        committee level, not the board level — a deliberate separation of
        capital, brand, and operations.
      </>
    ),
  },
  {
    title: "Insurance",
    body: (
      <>
        Cyber, E&amp;O, GL, employer’s liability, D&amp;O, Tech E&amp;O.
        Certificates available to enterprise customers under NDA.
      </>
    ),
  },
  {
    title: "Tax",
    body: (
      <>
        Relay, Inc. is a US-resident taxpayer. Sales tax collected per US
        state nexus. VAT collected for EU/UK consumer transactions. India
        operations covered by local entity GST registration.
      </>
    ),
  },
  {
    title: "Independence by design",
    body: (
      <>
        Capital, brand, and operations sit in separate boxes. Asgard funds.
        Relay, Inc. owns the brand and runs the bench. NINtec provides
        operational capacity through a service agreement. The boxes are kept
        separate so any one of them can change without breaking the others.
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <Shell>
      {/* Hero — 2-col: title + lede on left, sigil card on right */}
      <section style={{ padding: "56px 0 48px" }}>
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr",
              gap: 64,
              alignItems: "center",
            }}
          >
            <div>
              <h1
                className="r-h-display"
                style={{
                  margin: 0,
                  fontSize: "clamp(38px, 4.8vw, 64px)",
                  letterSpacing: "-0.022em",
                  lineHeight: 1.04,
                }}
              >
                A new company. <em>By design.</em>
              </h1>
              <p
                className="r-lede"
                style={{
                  marginTop: 18,
                  maxWidth: "44ch",
                  fontSize: "clamp(15px, 1.3vw, 18px)",
                }}
              >
                Relay was built around a single gesture — a press, inside
                the AI tool you’re already using, that puts a senior
                engineer in your session. Everything else about the
                company is downstream of that one promise.
              </p>
            </div>

            {/* Sigil card */}
            <div
              style={{
                background: "var(--ink)",
                color: "var(--cream)",
                borderRadius: 14,
                padding: 32,
                position: "relative",
                overflow: "hidden",
              }}
              aria-hidden="true"
            >
              {/* Subtle radial accent */}
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(circle at 70% 20%, rgba(79,107,58,0.18), transparent 50%)",
                }}
              ></span>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  fontSize: 56,
                  letterSpacing: "0.02em",
                  marginBottom: 20,
                }}
              >
                <span>RELAY</span>
                <span className="r-mark-dot"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--green)",
                    display: "inline-block",
                    marginLeft: 4,
                  }}></span>
              </div>
              <div
                style={{
                  position: "relative",
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  rowGap: 10,
                  columnGap: 16,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "rgba(244,242,238,0.6)",
                  borderTop: "1px solid rgba(244,242,238,0.12)",
                  paddingTop: 18,
                }}
              >
                <span>Founded</span>
                <span style={{ color: "var(--cream)", fontFamily: "var(--font-sans)", textTransform: "none", fontSize: 13 }}>
                  2026
                </span>
                <span>HQ</span>
                <span style={{ color: "var(--cream)", fontFamily: "var(--font-sans)", textTransform: "none", fontSize: 13 }}>
                  Manhattan, New York
                </span>
                <span>Entity</span>
                <span style={{ color: "var(--cream)", fontFamily: "var(--font-sans)", textTransform: "none", fontSize: 13 }}>
                  Relay, Inc. · Delaware C-Corp
                </span>
                <span>Domain</span>
                <span style={{ color: "#a4c074", fontFamily: "var(--font-sans)", textTransform: "none", fontSize: 13, fontStyle: "italic" }}>
                  relay.green
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Manifesto pull-quote */}
      <section
        style={{
          background: "var(--paper)",
          padding: "72px 0",
          borderTop: "1px solid var(--rule)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div className="r-wrap-narrow">
          <blockquote
            style={{
              margin: 0,
              padding: 0,
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px, 3.4vw, 44px)",
              lineHeight: 1.15,
              letterSpacing: "-0.018em",
              color: "var(--ink)",
              borderLeft: "3px solid var(--green)",
              paddingLeft: 24,
            }}
          >
            We don’t sell hours. We don’t run a marketplace.{" "}
            <em>The product is a relationship.</em>
          </blockquote>
          <p
            className="r-body"
            style={{
              marginTop: 24,
              fontSize: 16,
              lineHeight: 1.65,
              maxWidth: "62ch",
            }}
          >
            We employ the engineers who pick up the press, on a unified
            standard, in every country we operate in. The same engineer who
            joins you in build is the one who launches you, and the one who
            keeps you running. That’s the whole company.
          </p>
        </div>
      </section>

      {/* Three pillars — cards with icons */}
      <section className="r-section" style={{ borderTop: "none" }}>
        <div className="r-wrap">
          <h2
            className="r-h-1"
            style={{
              margin: "0 0 36px",
              fontSize: "clamp(28px, 3vw, 40px)",
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              maxWidth: "20ch",
            }}
          >
            The structure, on <em>three plain lines.</em>
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {PILLARS.map((p) => (
              <div
                key={p.num}
                style={{
                  background: "var(--cream)",
                  border: "1px solid var(--rule)",
                  borderRadius: 12,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 18,
                  }}
                >
                  <span
                    style={{
                      color: "var(--green-deep)",
                      display: "inline-flex",
                    }}
                  >
                    {p.icon}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ink-mute)",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {p.num}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--ink-mute)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  {p.label}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: 22,
                    letterSpacing: "-0.01em",
                    margin: "0 0 12px",
                    color: "var(--ink)",
                  }}
                >
                  {p.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: 0,
                  }}
                >
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Reach — stats band on dark ink */}
      <section
        style={{
          background: "var(--ink)",
          color: "var(--cream)",
          padding: "64px 0",
        }}
      >
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: 56,
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "rgba(244,242,238,0.5)",
                  marginBottom: 14,
                }}
              >
                Global reach
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 400,
                  fontSize: "clamp(26px, 2.8vw, 36px)",
                  letterSpacing: "-0.018em",
                  lineHeight: 1.1,
                  margin: 0,
                  color: "var(--cream)",
                  maxWidth: "16ch",
                }}
              >
                Backed by depth, <em style={{ color: "#a4c074" }}>not improvisation.</em>
              </h2>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 0,
              }}
            >
              {REACH_STATS.map((s, i) => (
                <div
                  key={s.label}
                  style={{
                    padding: "8px 16px",
                    borderRight:
                      i < REACH_STATS.length - 1
                        ? "1px solid rgba(244,242,238,0.12)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "clamp(34px, 4vw, 52px)",
                      lineHeight: 1,
                      color: "var(--cream)",
                      letterSpacing: "-0.022em",
                      marginBottom: 8,
                    }}
                  >
                    {s.num}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "rgba(244,242,238,0.55)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Governance breakdown — 2-col tabular */}
      <section className="r-section" style={{ borderTop: "none" }}>
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: 56,
              alignItems: "start",
              marginBottom: 32,
            }}
          >
            <h2
              className="r-h-1"
              style={{
                margin: 0,
                fontSize: "clamp(28px, 3vw, 40px)",
                letterSpacing: "-0.018em",
                lineHeight: 1.1,
                maxWidth: "12ch",
                position: "sticky",
                top: 96,
              }}
            >
              How Relay is owned, <em>funded, and run.</em>
            </h2>
            <div>
              <p
                className="r-body"
                style={{
                  fontSize: 15,
                  color: "var(--ink-soft)",
                  marginBottom: 28,
                  maxWidth: "58ch",
                }}
              >
                For journalists, regulators, customers’ security teams, and
                anyone who wants the structure on one screen.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 32,
                }}
              >
                <GovernanceColumn items={GOVERNANCE_LEFT} />
                <GovernanceColumn items={GOVERNANCE_RIGHT} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Press & investor inquiries — contact card */}
      <section
        style={{
          padding: "56px 0",
          background: "var(--paper)",
          borderTop: "1px solid var(--rule)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
              maxWidth: 880,
              margin: "0 auto",
            }}
          >
            <ContactCard
              label="Press"
              email="press@relay.green"
              note="Quotes, founder interviews, brand assets."
            />
            <ContactCard
              label="Investors"
              email="investors@relay.green"
              note="Capital, board, and corporate development."
            />
          </div>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            The simplest way to meet us
            <br />
            is to <em>press the dot.</em>
          </h2>
          <p className="r-lede">
            One press. A senior engineer joins your session in seconds.
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
            <Link
              href="/company/contact"
              className="r-btn r-btn-ghost"
              style={{
                borderColor: "rgba(244,242,238,0.3)",
                color: "var(--cream)",
                textDecoration: "none",
              }}
            >
              Talk to us <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}

function GovernanceColumn({
  items,
}: {
  items: { title: string; body: React.ReactNode }[];
}) {
  return (
    <div>
      {items.map((s, i) => (
        <div
          key={s.title}
          style={{
            paddingTop: i === 0 ? 0 : 20,
            paddingBottom: 20,
            borderBottom:
              i === items.length - 1 ? "none" : "1px solid var(--rule)",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: "0.02em",
              margin: "0 0 8px",
              color: "var(--ink)",
              textTransform: "uppercase",
            }}
          >
            {s.title}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--ink-soft)",
            }}
          >
            {s.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function ContactCard({
  label,
  email,
  note,
}: {
  label: string;
  email: string;
  note: string;
}) {
  return (
    <a
      href={`mailto:${email}`}
      style={{
        background: "var(--cream)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: 24,
        display: "block",
        textDecoration: "none",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-mute)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          letterSpacing: "-0.01em",
          color: "var(--green-deep)",
          marginBottom: 8,
        }}
      >
        {email} <span style={{ fontSize: 16 }}>→</span>
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--ink-soft)",
          lineHeight: 1.5,
        }}
      >
        {note}
      </div>
    </a>
  );
}
