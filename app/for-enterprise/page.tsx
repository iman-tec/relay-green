/*
 * /for-enterprise — Enterprise marketing page (redesigned).
 *
 * Hero → market signals → value props → architecture (text + diagram) →
 * operational backbone (NINtec Systems with stats) → CTA. No eyebrow chrome.
 * Sections lean into editorial typography rather than labelled chunks.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";

export const metadata: Metadata = {
  title: "Relay — For Enterprise",
  description:
    "Engineering depth, flexible access. Built for the team that ships. Backed by NINtec Systems — a Gateway Group company with 2,000+ engineers across 15 countries.",
};

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const SIGNALS = [
  "Every Lovable, Cursor, Replit support Discord is full of “is anyone available to help?”",
  "Fortune 500 CIOs are reporting 4,000+ shadow AI tools per organization, with no governance layer.",
  "Junior developer hiring has compressed; senior demand has exploded — the market wants experienced humans in the loop.",
  "Enterprise procurement teams are asking for “Citizen Developer Enablement” line items that don’t exist as a category yet.",
  "AI dev tool platforms themselves are quietly partnering with services firms for the human layer they cannot build.",
];

const VALUE_PROPS = [
  {
    title: "Business units move autonomously",
    body: "Non-technical teams can build with AI while staying aligned with engineering standards. Relay gives them a direct path to production-ready software.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
      </svg>
    ),
  },
  {
    title: "Trust and compliance by design",
    body: "Security review, data handling, and audit trails are embedded in the workflow from the start — strengthening confidence at every step.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M12 3l8 4v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Engineering depth, flexible access",
    body: "Access senior engineers on demand without headcount approvals, hiring cycles, or long-term contracts.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    title: "Operational continuity by design",
    body: "Relay engineers stay with your teams. Context compounds. Knowledge deepens as projects grow and evolve.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" />
        <path d="M20 4v5h-5M4 20v-5h5" />
      </svg>
    ),
  },
];

const NINTEC_STATS = [
  { num: "2,000+", label: "Engineering talent" },
  { num: "15", label: "Countries" },
  { num: "24/7", label: "Follow-the-sun delivery" },
  { num: "29", label: "Years of delivery" },
];

function RelayMark({
  size = 11,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        fontWeight: 500,
        fontSize: size,
        color,
        fontFamily: "var(--font-sans)",
      }}
    >
      <span>Relay</span>
      <span className="r-mark-dot"
        style={{
          width: Math.round(size * 0.78),
          height: Math.round(size * 0.78),
          borderRadius: "50%",
          background: "var(--green)",
          display: "inline-block",
          marginLeft: 2,
        }}></span>
    </span>
  );
}

export default function ForEnterprisePage() {
  return (
    <Shell>
      {/* Local CSS for the signals fade-up animation. Modern browsers use
          animation-timeline: view() for scroll-triggered playback; older
          browsers get the animation on first render. prefers-reduced-motion
          disables it entirely. */}
      <style>{`
        @keyframes signal-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .signal-item {
          opacity: 0;
          animation: signal-fade-up 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
        }
        .signal-item:nth-child(1) { animation-delay: 0.05s; }
        .signal-item:nth-child(2) { animation-delay: 0.15s; }
        .signal-item:nth-child(3) { animation-delay: 0.25s; }
        .signal-item:nth-child(4) { animation-delay: 0.35s; }
        .signal-item:nth-child(5) { animation-delay: 0.45s; }
        @supports (animation-timeline: view()) {
          .signal-item {
            animation-timeline: view();
            animation-range: entry 0% entry 50%;
            animation-delay: 0s;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .signal-item {
            opacity: 1;
            animation: none;
          }
        }
        @keyframes ear-pulse {
          0%, 100% { transform: scale(1);   opacity: 0.55; }
          50%      { transform: scale(1.6); opacity: 0;    }
        }
        .ear-dot {
          position: relative;
          display: inline-block;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: var(--green);
          margin-left: 8px;
          vertical-align: 2px;
        }
        .ear-dot::before {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          background: var(--green);
          opacity: 0.55;
          animation: ear-pulse 2.4s cubic-bezier(0.2, 0.7, 0.2, 1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ear-dot::before { animation: none; opacity: 0; }
        }
      `}</style>

      {/* Hero */}
      <section style={{ padding: "48px 0 24px" }}>
        <div
          className="r-wrap"
          style={{ textAlign: "center", maxWidth: "60ch", margin: "0 auto" }}
        >
          <h1
            className="r-h-display"
            style={{
              margin: 0,
              fontSize: "clamp(36px, 4.6vw, 60px)",
              letterSpacing: "-0.022em",
              lineHeight: 1.05,
            }}
          >
            Built for the team that <em>ships.</em>
          </h1>
          <p
            className="r-lede"
            style={{
              marginTop: 16,
              marginLeft: "auto",
              marginRight: "auto",
              maxWidth: "58ch",
              fontSize: "clamp(15px, 1.3vw, 18px)",
            }}
          >
            Relay brings engineering judgment into AI-driven build sessions —
            at the speed of your team and the rigor of your compliance team.
            One press, one engineer, governed by default.
          </p>
        </div>
      </section>

      {/* Market signals — "The market is shouting. We're listening." */}
      <section
        style={{
          padding: "56px 0 96px",
          borderTop: "none",
        }}
      >
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)",
              gap: 64,
              alignItems: "start",
            }}
          >
            <div style={{ position: "sticky", top: 96 }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 18,
                }}
              >
                What we’re hearing
              </div>
              <h2
                className="r-h-1"
                style={{
                  margin: 0,
                  fontSize: "clamp(34px, 4vw, 56px)",
                  letterSpacing: "-0.022em",
                  lineHeight: 1.05,
                  maxWidth: "14ch",
                }}
              >
                The market is shouting.
                <br />
                <em>We’re listening.</em>
                <span className="ear-dot" aria-hidden="true"></span>
              </h2>
              <p
                style={{
                  marginTop: 20,
                  fontSize: 14,
                  color: "var(--ink-soft)",
                  maxWidth: "30ch",
                  lineHeight: 1.6,
                }}
              >
                Five signals from the field — Discord threads, CIO reports,
                hiring funnels, procurement asks, partnership noise.
              </p>
            </div>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {SIGNALS.map((signal, i) => (
                <li
                  key={signal}
                  className="signal-item"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 1fr",
                    gap: 16,
                    alignItems: "start",
                    padding: "20px 0",
                    borderBottom:
                      i < SIGNALS.length - 1
                        ? "1px solid var(--rule)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--green-deep)",
                      letterSpacing: "0.04em",
                      paddingTop: 4,
                      fontWeight: 500,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 16,
                      lineHeight: 1.55,
                      color: "var(--ink)",
                      fontFamily: "var(--font-display)",
                      fontWeight: 400,
                    }}
                  >
                    {signal}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Value proposition — 4 cards */}
      <section
        className="r-section"
        style={{ background: "var(--paper)" }}
      >
        <div className="r-wrap">
          <h2
            className="r-h-1"
            style={{
              textAlign: "center",
              margin: "0 auto 40px",
              fontSize: "clamp(28px, 3.2vw, 44px)",
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              maxWidth: "22ch",
            }}
          >
            Ship faster with <em>engineering partnership.</em>
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {VALUE_PROPS.map((vp) => (
              <div
                key={vp.title}
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
                    color: "var(--green-deep)",
                    marginBottom: 16,
                    display: "inline-flex",
                  }}
                >
                  {vp.icon}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                    fontSize: 16,
                    letterSpacing: "-0.005em",
                    margin: "0 0 10px",
                    color: "var(--ink)",
                  }}
                >
                  {vp.title}
                </h3>
                <p
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: 0,
                  }}
                >
                  {vp.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture — text + diagram */}
      <section className="r-section">
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 56,
              alignItems: "center",
            }}
          >
            <div>
              <h2
                className="r-h-1"
                style={{
                  margin: "0 0 18px",
                  fontSize: "clamp(26px, 2.8vw, 38px)",
                  letterSpacing: "-0.018em",
                  lineHeight: 1.1,
                  maxWidth: "18ch",
                }}
              >
                <RelayMark size={26} color="var(--ink)" /> as an{" "}
                <em>enablement layer.</em>
              </h2>
              <p
                className="r-body"
                style={{
                  marginBottom: 20,
                  maxWidth: "44ch",
                  fontSize: 15,
                  lineHeight: 1.6,
                }}
              >
                Think of Relay as the connective tissue between AI
                generation tools and your production infrastructure. It
                does not replace your engineering teams — it amplifies
                everyone who uses AI to build with confidence and precision.
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {[
                  "Embeds into existing AI builder tools",
                  "Connects to your SSO, audit, and compliance systems",
                  "Scales from team-of-one to org-wide deployment",
                ].map((item) => (
                  <li
                    key={item}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      fontSize: 14,
                      color: "var(--ink-soft)",
                    }}
                  >
                    <span
                      style={{
                        marginTop: 4,
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        borderRadius: "50%",
                        background: "var(--green-tint)",
                        border: "1px solid rgba(79,107,58,0.3)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        stroke="var(--green-deep)"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1.5 4.2L3 5.7 6.5 2.2" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Diagram */}
            <div
              style={{
                background: "var(--paper)",
                border: "1px solid var(--rule)",
                borderRadius: 14,
                padding: 36,
                aspectRatio: "5 / 4",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
              aria-hidden="true"
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--ink-mute)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                <PillarIcon label="AI tool" iconKind="grid" />
                <PillarIcon label="Relay" iconKind="dot" highlight />
                <PillarIcon label="Production" iconKind="user" />
              </div>

              <div
                style={{
                  position: "absolute",
                  top: "30%",
                  left: "12%",
                  right: "12%",
                  height: 1,
                  background:
                    "linear-gradient(90deg, transparent, var(--rule) 15%, var(--rule) 85%, transparent)",
                }}
              ></div>

              <div
                style={{
                  alignSelf: "center",
                  marginTop: "auto",
                  width: "100%",
                  maxWidth: 280,
                  background: "var(--cream)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--ink-mute)",
                    marginBottom: 6,
                  }}
                >
                  Enterprise · Relay session
                </div>
                <div
                  style={{
                    height: 4,
                    background: "var(--green-tint)",
                    borderRadius: 999,
                    marginBottom: 5,
                  }}
                ></div>
                <div
                  style={{
                    height: 4,
                    background: "var(--rule)",
                    borderRadius: 999,
                    width: "78%",
                  }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Operational backbone — NINtec Systems */}
      <section
        className="r-section"
        style={{ background: "var(--paper)" }}
      >
        <div className="r-wrap">
          <h2
            className="r-h-1"
            style={{
              textAlign: "center",
              margin: "0 auto 40px",
              fontSize: "clamp(28px, 3.2vw, 44px)",
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              maxWidth: "20ch",
            }}
          >
            Operational backbone you can <em>trust.</em>
          </h2>

          <div
            style={{
              maxWidth: 880,
              margin: "0 auto",
              background: "var(--cream)",
              border: "1px solid var(--rule)",
              borderRadius: 14,
              padding: 36,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
                marginBottom: 20,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" />
                </svg>
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                    fontSize: 18,
                    letterSpacing: "-0.005em",
                    margin: "0 0 4px",
                    color: "var(--ink)",
                  }}
                >
                  NINtec Systems
                </h3>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--ink-mute)",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  Parent · Operational backbone · NSE/BSE listed · Gateway
                  Group company
                </div>
              </div>
            </div>

            <p
              className="r-body"
              style={{
                margin: "0 0 24px",
                fontSize: 15,
                lineHeight: 1.65,
              }}
            >
              <RelayMark size={13} color="var(--ink)" /> is backed by the
              engineering depth, global delivery capability, and enterprise
              operational discipline of NINtec Systems — an NSE/BSE listed
              software engineering firm and part of the Gateway Group. This
              is not a startup figuring out scale. It is a product built on
              twenty-nine years of delivery experience, with access to over
              two thousand engineers across fifteen countries on a true
              follow-the-sun, twenty-four-by-seven model.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 0,
                borderTop: "1px solid var(--rule)",
              }}
            >
              {NINTEC_STATS.map((s, i) => (
                <div
                  key={s.label}
                  style={{
                    padding: "20px 16px",
                    borderRight:
                      i < NINTEC_STATS.length - 1
                        ? "1px solid var(--rule)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "clamp(26px, 3vw, 36px)",
                      lineHeight: 1,
                      color: "var(--ink)",
                      letterSpacing: "-0.02em",
                      marginBottom: 6,
                    }}
                  >
                    {s.num}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--ink-mute)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 20,
                display: "flex",
                gap: 24,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <Link
                href="/company/about"
                style={{
                  fontSize: 14,
                  color: "var(--green-deep)",
                  fontWeight: 500,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Learn about Relay’s story{" "}
                <span style={{ fontSize: 12 }}>→</span>
              </Link>
              <a
                href="https://www.nintecsystems.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 14,
                  color: "var(--ink-soft)",
                  fontWeight: 500,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Visit nintecsystems.com{" "}
                <span style={{ fontSize: 12 }}>↗</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          background: "var(--ink)",
          color: "var(--cream)",
          padding: "72px 0",
          textAlign: "center",
        }}
      >
        <div className="r-wrap-narrow">
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px, 3.2vw, 40px)",
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              fontWeight: 400,
              margin: "0 0 12px",
              color: "var(--cream)",
            }}
          >
            Ready to enable your <em style={{ color: "#a4c074" }}>teams?</em>
          </h2>
          <p
            style={{
              fontSize: 16,
              color: "rgba(244,242,238,0.7)",
              margin: "0 0 28px",
            }}
          >
            Let’s talk about how Relay fits your organization.
          </p>
          <a
            href="mailto:support@relay.green?subject=Relay%20—%20Enterprise%20inquiry"
            className="r-btn r-btn-green"
            style={{ height: 44, padding: "0 24px" }}
          >
            Talk to Relay for Enterprise <span className="arrow">→</span>
          </a>
        </div>
      </section>
    </Shell>
  );
}

/**
 * Tiny pillar icon for the architecture diagram.
 */
function PillarIcon({
  label,
  iconKind,
  highlight = false,
}: {
  label: string;
  iconKind: "grid" | "dot" | "user";
  highlight?: boolean;
}) {
  const stroke = highlight ? "var(--green-deep)" : "var(--ink-soft)";
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: highlight ? "var(--green-tint)" : "var(--cream)",
          border: `1px solid ${highlight ? "rgba(79,107,58,0.3)" : "var(--rule)"}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {iconKind === "grid" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke={stroke}
            strokeWidth="1.4"
          >
            <rect x="1.5" y="1.5" width="4" height="4" rx="0.5" />
            <rect x="8.5" y="1.5" width="4" height="4" rx="0.5" />
            <rect x="1.5" y="8.5" width="4" height="4" rx="0.5" />
            <rect x="8.5" y="8.5" width="4" height="4" rx="0.5" />
          </svg>
        )}
        {iconKind === "dot" && (
          <span
            className="r-mark-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--green)",
            }}
          />
        )}
        {iconKind === "user" && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke={stroke}
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <circle cx="7" cy="4.5" r="2.2" />
            <path d="M2.5 12c0-2.4 2-4 4.5-4s4.5 1.6 4.5 4" />
          </svg>
        )}
      </span>
      <span style={{ fontSize: 9 }}>{label}</span>
    </span>
  );
}
