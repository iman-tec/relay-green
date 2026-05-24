/*
 * /for-enterprise, Enterprise marketing page (redesigned).
 *
 * Hero → market signals → value props → architecture (text + diagram) →
 * operational backbone (NINtec Systems with stats) → CTA. No eyebrow chrome.
 * Sections lean into editorial typography rather than labelled chunks.
 */

import type { Metadata } from "next";
import { Shell } from "../_marketing/Shell";
import { RelayLogo } from "../_marketing/RelayLogo";
import { EnterpriseCtaButton } from "../_marketing/EnterpriseCtaButton";
import { JsonLd } from "../_marketing/JsonLd";
import {
  breadcrumbSchema,
  webPageSchema,
} from "../../lib/seo/schema";

const SITE_URL = "https://www.relay.green";

export const metadata: Metadata = {
  title: "For Enterprise",
  description:
    "Superpowers for every Non Technical AI builder in your team. RELAY ensures it works. Real engineers join AI-driven build sessions in seconds, one press away, governed by default. Backed by NINtec Systems with 2,000+ engineers across 15 countries.",
  alternates: { canonical: "/for-enterprise" },
};

const SIGNALS = [
  "Every Lovable, Cursor, Replit support Discord is full of “is anyone available to help?”",
  "Fortune 500 CIOs are reporting 4,000+ shadow AI tools per organization, with no governance layer.",
  "Junior developer hiring has compressed; senior demand has exploded, the market wants experienced humans in the loop.",
  "Enterprise procurement teams are asking for “Citizen Developer Enablement” line items that don’t exist as a category yet.",
  "AI dev tool platforms themselves are quietly partnering with services firms for the human layer they cannot build.",
];

/* "Shadow stack" — provocative dark callout with 4 stat tiles framing
   the cost of unsupervised AI app sprawl, and Relay's answer. Replaces
   the older "Deploy faster" feature grid. */
const SHADOW_STATS: { num: string; body: string }[] = [
  {
    num: "68%",
    body: "of marketing teams ship internal tools their IT didn't scope.",
  },
  {
    num: "3.2x",
    body: 'increase in "rogue" AI app deployments YoY at orgs > 500 people.',
  },
  {
    num: "14s",
    body: "avg time to a Relay engineer joining one of those builds.",
  },
  {
    num: "$0",
    body: "rebuilds. Relay starts where the AI left off.",
  },
];

/* Compact stat tiles for the Market Signals sidebar. Each one is a
   single number + a small mono-caps caption; the row reads like a
   spec sheet pinned next to the editorial column. */
const MARKET_STATS: { num: string; label: string }[] = [
  { num: "4,000+", label: "Shadow AI apps per F500 org" },
  { num: "47%", label: "Of non-tech staff using AI tools daily" },
  { num: "15+", label: "AI front-doors in a typical enterprise" },
];

/* Governance grid. Four primitives presented as a 2x2 with a badge-style
   icon next to each title. Quiet bottom strip surfaces the underlying
   governance primitives for scanners. */
const GOVERNANCE: { iconKey: string; title: string; body: string }[] = [
  {
    iconKey: "policy",
    title: "Org-wide policy controls",
    body: "Set guardrails once. Every session inherits your compliance posture: data handling, approved stacks, session recording, and audit retention.",
  },
  {
    iconKey: "sso",
    title: "SAML / SSO + role-based access",
    body: "Integrate with your identity provider. Control who can request sessions, who approves spend, and who reviews session logs. All from your admin dashboard.",
  },
  {
    iconKey: "audit",
    title: "Audit-ready by default",
    body: "Every session is logged, every decision is traceable. SOC 2, GDPR, and custom compliance frameworks are baked in, not bolted on.",
  },
  {
    iconKey: "chart",
    title: "Usage analytics & spend control",
    body: "See which teams are building, where time is spent, and how builds progress. Set budgets per department. No surprises.",
  },
];

/* Inline line-icon set used by both Ship-faster and Governance grids.
   24x24 viewBox, 1.5 stroke, currentColor — recolor via the parent's
   `color` style. Keep these minimal: the page's editorial register
   doesn't tolerate decorative icons. */
function EntIcon({ kind }: { kind: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "grid":
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 2L4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3L3 8l9 5 9-5-9-5z" />
          <path d="M3 13l9 5 9-5" />
          <path d="M3 18l9 5 9-5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M21 12a9 9 0 0 1-9 9 9.7 9.7 0 0 1-6-2.1L3 16M3 12a9 9 0 0 1 9-9c2.3 0 4.4.8 6 2.1L21 8" />
          <path d="M21 3v5h-5M3 21v-5h5" />
        </svg>
      );
    case "policy":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 2L4 5v7c0 4.5 3.5 8.5 8 10 4.5-1.5 8-5.5 8-10V5l-8-3z" />
        </svg>
      );
    case "sso":
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 21v-1a6 6 0 0 1 6-6c1.1 0 2.1.3 3 .8" />
          <path d="M15 14l2 2 4-4" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z" />
          <path d="M14 3v6h6" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 3v18h18" />
          <rect x="7" y="13" width="3" height="5" />
          <rect x="12" y="9" width="3" height="9" />
          <rect x="17" y="5" width="3" height="13" />
        </svg>
      );
    default:
      return null;
  }
}

/* Hero "conversations" card — five C-suite voices in one column, framed
   as the chatter you'd actually overhear at the leadership table this
   week. Each item is intentionally short and concrete; the punch comes
   from the cumulative pressure across roles, not from any one line. */
const HERO_CONVERSATIONS: { role: string; line: string }[] = [
  {
    role: "CEO",
    line: "AI transformation is a board-level metric. Your divisions are moving at different speeds.",
  },
  {
    role: "CMO",
    line: "Marketing is shipping landing pages, campaigns, micro-tools with AI. IT can’t resource it.",
  },
  {
    role: "CFO",
    line: "Procurement is being asked for shadow-AI tools weekly. The compliance surface is blurry.",
  },
  {
    role: "CSO",
    line: "Sales ops is wiring HubSpot, Salesforce, Slack with AI. One missing webhook breaks pipeline.",
  },
  {
    role: "CGO",
    line: "Growth needs experiments live yesterday. The eng backlog is six weeks deep.",
  },
];

/* Three-phase "how we embed" grid. Each card pairs a short paragraph
   with a small bullet list of concrete deliverables, framed inside a
   green-tinted pill at the top (Phase 01/02/03). */
const EMBED_PHASES: {
  id: string;
  title: string;
  body: string;
  bullets: string[];
}[] = [
  {
    id: "Phase 01",
    title: "Onboard & Align",
    body: "We map your stack, security posture, and build patterns. A named Relay lead is assigned to your org. They learn your architecture before the first session.",
    bullets: [
      "Stack audit & compatibility review",
      "Named lead & fallback engineer assigned",
      "SSO & policy configuration",
    ],
  },
  {
    id: "Phase 02",
    title: "Run & Govern",
    body: "Your teams press the green dot. Engineers join in seconds. Sessions are governed by your policies, audited, and reported.",
    bullets: [
      "On-demand sessions with policy enforcement",
      "Real-time admin dashboard",
      "Weekly usage & health reports",
    ],
  },
  {
    id: "Phase 03",
    title: "Scale & Embed",
    body: "As AI adoption grows across your org, Relay scales with you, more engineers, dedicated pods, embedded within your workflows.",
    bullets: [
      "Dedicated engineering pods",
      "Multi-region data residency",
      "Custom SLA & on-call rotations",
    ],
  },
];

export default function ForEnterprisePage() {
  return (
    <Shell>
      {/* Structured data: WebPage + BreadcrumbList for rich-result
          eligibility. Organization + WebSite schemas already render
          globally from app/layout.tsx. */}
      <JsonLd
        data={[
          webPageSchema({
            url: `${SITE_URL}/for-enterprise`,
            name: "Relay for Enterprise",
            description:
              "Govern the AI your team is already using. Real engineers join AI-driven build sessions in seconds, under your NDA, in your region, and on your audit trail.",
          }),
          breadcrumbSchema([
            { name: "Home", href: "/" },
            { name: "For Enterprise", href: "/for-enterprise" },
          ]),
        ]}
      />

      {/* Local CSS for the signals fade-up animation. Modern browsers use
          animation-timeline: view() for scroll-triggered playback; older
          browsers get the animation on first render. prefers-reduced-motion
          disables it entirely. */}
      <style>{`
        .enterprise-card-surface {
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.035),
            0 18px 48px rgba(0, 0, 0, 0.045);
          transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1),
            box-shadow 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
          position: relative;
        }
        .enterprise-card-surface:hover {
          /* Match the homepage .r-leg hover exactly: 3px lift +
             stronger shadow + title turns green-deep. z-index lifts
             the hovered card above its flush neighbors so the lift
             reads cleanly when the gap is 0. */
          transform: translateY(-3px);
          box-shadow: 0 16px 38px rgba(20, 20, 19, 0.07);
          z-index: 2;
        }
        .enterprise-card-surface:hover h3 {
          color: var(--green-deep, var(--green));
          transition: color 0.2s ease;
        }
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
          .enterprise-card-surface {
            transition: none;
          }
          .enterprise-card-surface:hover {
            transform: none;
          }
          .signal-item {
            opacity: 1;
            animation: none;
          }
        }
        @keyframes ear-pulse {
          0%, 100% { transform: scale(1);   opacity: 0.62; }
          50%      { transform: scale(2.1); opacity: 0;    }
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
          opacity: 0.62;
          animation: ear-pulse 2.2s cubic-bezier(0.2, 0.7, 0.2, 1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ear-dot::before { animation: none; opacity: 0; }
        }
        @media (max-width: 720px) {
          .enterprise-ship-heading,
          .enterprise-backbone-heading,
          .enterprise-embed-heading,
          .enterprise-governance-heading {
            white-space: normal !important;
          }
        }
      `}</style>

      {/* Hero — C-suite framing.
          LEFT: dot-eyebrow targeting CEOs/CMOs/CFOs/CSOs/CGOs, an
          oversized editorial headline ("Your teams are already building
          with AI. Relay is how they finish."), a lede that names the
          structural reason internal IT can't keep up, a green primary
          CTA + ghost "Trust posture" jump-link, and a quiet compliance
          strip on the floor.
          RIGHT: a credential card titled "THE CONVERSATIONS HAPPENING
          IN YOUR ORG THIS WEEK" with five C-suite voices, one per row.
          The card grounds the abstract headline in language the reader
          actually hears at their own table. */}
      <section
        className="r-enterprise-hero"
        style={{
          padding: "78px 0 64px",
          background: "#ffffff",
        }}
      >
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.06fr) minmax(320px, 0.84fr)",
              gap: 48,
              alignItems: "center",
            }}
          >
            {/* LEFT COLUMN */}
            <div>
              {/* Dot-eyebrow targeting the C-suite reader. No pill —
                  just a quiet green dot + mono caps, parallel to the
                  Trust Posture / Operational Backbone section
                  eyebrows below. */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 18,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--green)",
                    display: "inline-block",
                  }}
                  aria-hidden="true"
                ></span>
                For CEOs, CMOs, CFOs, CSOs, CGOs
              </div>

              {/* Oversized editorial headline. The RELAY● lockup lands
                  inline at "1em" so the wordmark sits in the same optical
                  register as the surrounding type and the green dot keeps
                  its pulse. */}
              <h1
                className="r-h-display"
                style={{
                  margin: "0 0 22px",
                  fontSize: "clamp(34px, 4.4vw, 58px)",
                  letterSpacing: "-0.034em",
                  lineHeight: 1.04,
                  textWrap: "balance",
                }}
              >
                <em
                  style={{ color: "var(--green)", fontStyle: "italic" }}
                >
                  Govern
                </em>{" "}
                the AI
                <br />
                your team is
                <br />
                <span style={{ color: "var(--green)" }}>already using.</span>
                <span
                  aria-hidden="true"
                  style={{
                    display: "block",
                    width: 128,
                    height: 1,
                    margin: "18px 0 16px",
                    background: "#d2d2d7",
                  }}
                />
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: 8,
                    fontSize: "clamp(28px, 3vw, 42px)",
                    lineHeight: 1.05,
                    whiteSpace: "nowrap",
                  }}
                >
                  <RelayLogo size="1em" color="var(--ink)" />
                  <span
                    style={{
                      color: "var(--green-deep)",
                      fontSize: "1.08em",
                      fontStyle: "italic",
                    }}
                  >
                    ensures it works.
                  </span>
                </span>
              </h1>

              {/* Lede. The "ship, under one standard..." cadence
                  intentionally uses a colon rather than an em-dash so
                  the qualifier still lands while obeying the no-
                  em-dash rule the brand follows. */}
              <p
                style={{
                  margin: "0 0 28px",
                  fontSize: "clamp(16px, 1.35vw, 20px)",
                  lineHeight: 1.5,
                  color: "var(--ink-soft)",
                  maxWidth: "54ch",
                }}
              >
                Your team is building with Cursor, Claude, and Lovable,
                whether IT signed off or not. Relay puts a qualified engineer
                behind every AI-built system in seconds:
                under your NDA, in your region, and on your audit trail.
              </p>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "center",
                  marginBottom: 24,
                }}
              >
                <EnterpriseCtaButton />
              </div>
            </div>

            {/* RIGHT COLUMN — "conversations" credential card */}
            <div>
              <div
                className="enterprise-card-surface"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(250,250,251,0.96) 100%)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: "28px 30px 12px",
                  boxShadow:
                    "0 1px 2px rgba(0,0,0,0.035), 0 22px 64px rgba(0,0,0,0.08)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--ink-mute)",
                    lineHeight: 1.5,
                    marginBottom: 22,
                    maxWidth: "30ch",
                  }}
                >
                  The conversations happening in your org this week
                </div>

                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                  }}
                >
                  {HERO_CONVERSATIONS.map((row, i) => (
                    <li
                      key={row.role}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "56px 1fr",
                        gap: 16,
                        alignItems: "start",
                        padding: "14px 0",
                        borderBottom:
                          i < HERO_CONVERSATIONS.length - 1
                            ? "1px solid var(--rule)"
                            : "none",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          color: "var(--green-deep)",
                          paddingTop: 2,
                        }}
                      >
                        {row.role}
                      </span>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 14,
                          lineHeight: 1.55,
                          color: "var(--ink)",
                        }}
                      >
                        {row.line}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Market signals — dark band. Inverted from the surrounding
          light sections so it reads as a high-impact "pressure" beat:
          the editorial heading on the left, the 6 stat tiles in a
          row beneath it, and the 5 signals as a list in the right
          column. */}
      <section
        style={{
          padding: "88px 0",
          background: "linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%)",
          color: "var(--ink)",
        }}
      >
        <div className="r-wrap">
          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)",
              gap: 56,
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 16,
                }}
              >
                What we’re hearing
              </div>
              <h2
                className="r-h-1"
                style={{
                  margin: 0,
                  fontSize: "clamp(32px, 3.8vw, 52px)",
                  letterSpacing: "-0.034em",
                  lineHeight: 0.98,
                  maxWidth: "24ch",
                  color: "var(--ink)",
                }}
              >
                The market is shouting.{" "}
                <em
                  style={{
                    color: "var(--green-deep)",
                    whiteSpace: "nowrap",
                  }}
                >
                  We’re listening.
                </em>
                <span className="ear-dot" aria-hidden="true"></span>
              </h2>
              <p
                style={{
                  marginTop: 16,
                  fontSize: 13.5,
                  color: "var(--ink-soft)",
                  maxWidth: "56ch",
                  lineHeight: 1.6,
                }}
              >
                Five signals from the field, Discord threads, CIO reports,
                hiring funnels, procurement asks, partnership noise.
              </p>

              {/* Stat tiles — compact on dark, no card chrome. Numbers
                  in green pop against ink; captions in muted cream caps. */}
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "28px 0 0",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: "20px 18px",
                }}
              >
                {MARKET_STATS.map((s) => (
                  <li key={s.label}>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "clamp(22px, 2vw, 30px)",
                        lineHeight: 1.05,
                        letterSpacing: "-0.018em",
                        color: "var(--green-deep)",
                        marginBottom: 6,
                        fontWeight: 500,
                      }}
                    >
                      {s.num}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        lineHeight: 1.4,
                        color: "var(--ink-mute)",
                      }}
                    >
                      {s.label}
                    </div>
                  </li>
                ))}
              </ul>
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
                    gridTemplateColumns: "40px 1fr",
                    gap: 16,
                    alignItems: "start",
                    padding: "16px 0",
                    borderBottom:
                      i < SIGNALS.length - 1 ? "1px solid var(--rule)" : "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
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
                      fontSize: 15,
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

      {/* Shadow stack — dark provocative callout. Eyebrow + bold serif
          headline with italic + bright-green accent, then a 4-tile stats
          grid. Replaces the older "Deploy faster" white feature grid;
          intentionally a dark island between the surrounding white/grey
          sections to give the stats visual weight. */}
      <section
        style={{
          padding: "clamp(72px, 8vw, 110px) 0",
          background: "#06090a",
        }}
      >
        <div
          className="r-wrap"
          style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--green)",
              marginBottom: 24,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--green)",
                display: "inline-block",
              }}
            />
            The shadow stack
          </div>

          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px, 3.6vw, 48px)",
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              color: "var(--cream)",
              margin: "0 0 56px",
            }}
          >
            Half your team is shipping{" "}
            <em style={{ fontStyle: "italic" }}>Lovable apps</em> to prod.
            <br />
            The other half is fixing them{" "}
            <span style={{ color: "var(--green)", fontWeight: 500 }}>
              quietly.
            </span>
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {SHADOW_STATS.map((stat) => (
              <div
                key={stat.num}
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 16,
                  padding: "32px 28px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(48px, 5vw, 68px)",
                    fontWeight: 400,
                    lineHeight: 1,
                    color: "var(--green)",
                    letterSpacing: "-0.02em",
                    marginBottom: 24,
                  }}
                >
                  {stat.num}
                </div>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "rgba(244, 242, 238, 0.7)",
                    margin: 0,
                    maxWidth: "28ch",
                  }}
                >
                  {stat.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Governance that scales — forced 4-column grid on desktop so
          all governance primitives sit on a single row; r-grid-collapse-md
          drops to 1fr below 768px. Wrap widened to 1200 to give each card
          breathing room at 4-up. */}
      <section style={{ padding: "88px 0", background: "#f5f5f7" }}>
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ marginBottom: 40, textAlign: "center" }}>
            <h2
              className="r-h-1"
              style={{
                margin: "0 auto",
                maxWidth: "none",
                fontSize: "clamp(28px, 3vw, 42px)",
                letterSpacing: "-0.026em",
                lineHeight: 1.04,
                textWrap: "balance",
                whiteSpace: "nowrap",
              }}
            >
              Governance that scales with <em>your organization</em>
            </h2>
          </div>

          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 0,
            }}
          >
            {GOVERNANCE.map((card) => (
              <div
                key={card.title}
                className="enterprise-card-surface"
                style={{
                  background: "#ffffff",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: 28,
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "#ffffff",
                    border: "1px solid var(--rule)",
                    color: "var(--green-deep)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <EntIcon kind={card.iconKey} />
                </div>
                <div>
                  <h3
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 400,
                      fontSize: "clamp(15px, 1.2vw, 17px)",
                      letterSpacing: "-0.008em",
                      lineHeight: 1.25,
                      margin: "0 0 8px",
                      color: "var(--ink)",
                    }}
                  >
                    {card.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: "var(--ink-soft)",
                      margin: 0,
                    }}
                  >
                    {card.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 32,
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-mute)",
            }}
          >
            Policies · approvals · audit logs · session recordings · data
            residency · custom retention
          </div>
        </div>
      </section>

      {/* What you get — 6-card org-wide retainer breakdown on a dark
          island. Three columns × two rows; titles in brand-green with the
          .mk-sweep underline that draws L→R on card hover. Matches the
          Shadow Stack visual language earlier on this page. */}
      <section
        style={{
          padding: "clamp(56px, 6.5vw, 88px) 0",
          background: "#06090a",
        }}
      >
        <div
          className="r-wrap"
          style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--green)",
              marginBottom: 20,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--green)",
                display: "inline-block",
              }}
            />
            What you get
          </div>

          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: 56,
              alignItems: "start",
              marginBottom: 40,
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(32px, 4.2vw, 56px)",
                fontWeight: 400,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                color: "var(--cream)",
                margin: 0,
              }}
            >
              One contract.{" "}
              <em style={{ fontStyle: "italic", color: "var(--green)" }}>
                Organization-wide cover.
              </em>
            </h2>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 16,
                lineHeight: 1.6,
                color: "rgba(244, 242, 238, 0.7)",
                margin: 0,
                maxWidth: "48ch",
              }}
            >
              A pooled retainer your whole org can press into — with
              single-pane visibility, audit logs, and a named team that learns
              your stack across departments.
            </p>
          </div>

          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 16,
            }}
          >
            {[
              {
                title: "Named Team",
                body: "A roster of 4–8 engineers who learn your stack across departments. Same humans every time.",
              },
              {
                title: "Pooled Hours",
                body: "One retainer for the org. Any team presses, any minute lands against the pool.",
              },
              {
                title: "Org Audit Logs",
                body: "Every session, every change, every commit. SIEM-ready. Splunk-ready. CISO-ready.",
              },
              {
                title: "Compliance Brief",
                body: "GDPR compliant. We sign your DPA.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="mk-stat-card"
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 16,
                  padding: "26px 28px 30px",
                }}
              >
                <h3
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 18,
                    fontWeight: 600,
                    margin: "0 0 12px",
                    letterSpacing: "-0.005em",
                  }}
                >
                  <span
                    className="mk-sweep"
                    style={{ color: "var(--green)" }}
                  >
                    {card.title}
                  </span>
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "rgba(244, 242, 238, 0.65)",
                    margin: 0,
                  }}
                >
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How we embed with your teams — three-phase grid; quiet green
          pill at top of each card carries the Phase 01/02/03 label, a
          short paragraph below the title, then a green-bullet deliverable
          list. Sits as the last narrative section before the closing CTA. */}
      <section
        style={{
          padding: "88px 0",
          background: "linear-gradient(180deg, #ffffff 0%, #f5f5f7 100%)",
        }}
      >
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ marginBottom: 40, textAlign: "center" }}>
            <h2
              className="r-h-1 enterprise-embed-heading"
              style={{
                margin: "0 auto",
                maxWidth: "none",
                fontSize: "clamp(28px, 3vw, 42px)",
                letterSpacing: "-0.026em",
                lineHeight: 1.04,
                textWrap: "balance",
                whiteSpace: "nowrap",
              }}
            >
              How we <em>embed</em> with your teams
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 0,
            }}
          >
            {EMBED_PHASES.map((phase) => (
              <div
                key={phase.id}
                className="enterprise-card-surface"
                style={{
                  background: "#ffffff",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: 30,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    alignSelf: "flex-start",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--ink-soft)",
                    padding: "4px 10px",
                    background: "#f5f5f7",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    marginBottom: 18,
                  }}
                >
                  {phase.id}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: "clamp(18px, 1.6vw, 22px)",
                    letterSpacing: "-0.01em",
                    lineHeight: 1.2,
                    margin: "0 0 12px",
                    color: "var(--ink)",
                  }}
                >
                  {phase.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: "0 0 16px",
                  }}
                >
                  {phase.body}
                </p>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {phase.bullets.map((b) => (
                    <li
                      key={b}
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "var(--ink-soft)",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          background: "var(--green)",
                          display: "inline-block",
                          marginTop: 8,
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          background: "#ffffff",
          color: "var(--ink)",
          padding: "88px 0 96px",
          textAlign: "center",
          borderTop: "1px solid #d2d2d7",
        }}
      >
        <div className="r-wrap-narrow">
          <div
            style={{
              maxWidth: 760,
              margin: "0 auto",
              padding: "44px 28px",
              border: "1px solid #d2d2d7",
              borderRadius: 8,
              background: "#f5f5f7",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 3.2vw, 40px)",
                letterSpacing: "-0.018em",
                lineHeight: 1.1,
                fontWeight: 400,
                margin: "0 0 12px",
                color: "var(--ink)",
              }}
            >
              Ready to enable your{" "}
              <em style={{ color: "var(--green)" }}>teams?</em>
            </h2>
            <p
              style={{
                fontSize: 16,
                color: "var(--ink-soft)",
                margin: "0 0 28px",
              }}
            >
              One press. One engineer. One governed standard, across your org.
            </p>
            <EnterpriseCtaButton />
          </div>
        </div>
      </section>
    </Shell>
  );
}
