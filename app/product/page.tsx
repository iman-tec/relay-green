/*
 * /product — How it works.
 *
 * Reordered: hero → audience cards → trust pillars → 6-frame how-it-works
 * sequence → modalities → on-the-record (Zoom + compliance) → pull quote →
 * CTA. The audience + trust pair sits right after the hero so a first-time
 * visitor sees who Relay is for and why to trust it before the operational
 * deep-dive.
 *
 * Animations: scroll-triggered fade-up on cards (animation-timeline: view()
 * with a stagger fallback for older browsers), hover lift on the audience
 * cards, animated underlines on the trust pillars, pulsing brand dots on
 * every RELAY• mark. All motion respects prefers-reduced-motion.
 */

import type { Metadata } from "next";
import { Shell } from "../_marketing/Shell";
import { TryRelayButton } from "../_marketing/TryRelayButton";
import { HowItWorks } from "../_marketing/HowItWorks";

export const metadata: Metadata = {
  title: "Relay — How it works",
  description:
    "Three phases. One team. Same engineer the whole way — from build through launch through ongoing maintenance.",
};

type Modality = {
  title: string;
  body: string;
  icon: React.ReactNode;
};

const ICON_PROPS = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const MODALITIES: Modality[] = [
  {
    title: "Live chat",
    body: "Instant messaging with context-aware engineers who can read your codebase, understand your stack, and guide you forward with precision — not generic answers.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M3 5h18v11H7l-4 4z" />
      </svg>
    ),
  },
  {
    title: "Voice",
    body: "Hop on a quick call when typing is not fast enough. Walk through architecture decisions, refine approaches, or simply think out loud with someone who understands the territory.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    ),
  },
  {
    title: "Screen share",
    body: "Show, do not explain. Share your screen and let an engineer point, navigate, and build with you side by side — as if they were sitting at the next desk.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

const AUDIENCES = [
  {
    tag: "Solo",
    title: "Solo builders",
    body: "Ship your side project without hiring a team. Get support, get deployed, and get the sleep that comes from knowing someone experienced has reviewed what you have built.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    tag: "Teams",
    title: "Teams inside companies",
    body: "Enable your AI-native team to move fast without breaking operations. Guardrails that feel like enablement, because they are designed by engineers who understand momentum.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <circle cx="9" cy="8" r="3.5" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6M14 21c0-2.5 1.7-4.5 4-4.5s4 2 4 4.5" />
      </svg>
    ),
  },
  {
    tag: "Enterprise",
    title: "Enterprise leaders",
    body: "Give every business unit a safe path from prototype to production. Scale AI-assisted building without the risk that comes from absence of engineering judgment.",
    icon: (
      <svg {...ICON_PROPS} aria-hidden="true">
        <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" />
      </svg>
    ),
  },
];

const TRUST_PILLARS = [
  {
    title: "Global delivery",
    body: "Engineers across time zones so help is always awake when you are — without compromising data residency where it matters.",
  },
  {
    title: "Enterprise-grade security",
    body: "SOC 2 aligned, GDPR aware, and built on a secure operational backbone that has served Fortune 500 clients.",
  },
  {
    title: "Engineer continuity",
    body: "Same engineer from first commit to fifth iteration. Context that compounds. Trust that deepens over time.",
  },
  {
    title: "Operational backbone",
    body: "Decades of enterprise delivery experience through NINtec Systems. This is not improvisation. It is discipline.",
  },
];

const SESSION_RAILS = [
  {
    num: "01",
    title: "Zoom-native",
    body: "Sessions run on Zoom — the platform your team already uses. No new tools, no logins to manage, no friction at the moment of need.",
  },
  {
    num: "02",
    title: "Recorded with context",
    body: "Recordings, transcripts, code diffs, and decisions are captured against your project — searchable, replayable, and tied to the work itself.",
  },
  {
    num: "03",
    title: "Project-aware",
    body: "Spin up projects, plan sprints, schedule the next session, and streamline ongoing work between presses. The session is part of the workflow.",
  },
  {
    num: "04",
    title: "Compliant by default",
    body: "GDPR-ready posture. Data-handling and access controls aligned to enterprise standards. Regional residency on the roadmap. Compliance is part of the product.",
  },
];

function RelayMark({
  size = 13,
  color = "var(--ink)",
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
      <span
        className="r-mark-dot"
        style={{
          width: Math.round(size * 0.78),
          height: Math.round(size * 0.78),
          borderRadius: "50%",
          background: "var(--green)",
          display: "inline-block",
          marginLeft: 2,
        }}
      ></span>
    </span>
  );
}

export default function ProductPage() {
  return (
    <Shell>
      {/* Page-local CSS — scroll-triggered fade-ups + hover effects.
          animation-timeline: view() in supporting browsers; staggered
          delays as fallback. prefers-reduced-motion turns it all off. */}
      <style>{`
        @keyframes prod-fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes prod-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes underline-grow {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .prod-fade {
          opacity: 0;
          animation: prod-fade-up 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
        }
        .prod-fade-1 { animation-delay: 0.05s; }
        .prod-fade-2 { animation-delay: 0.15s; }
        .prod-fade-3 { animation-delay: 0.25s; }
        .prod-fade-4 { animation-delay: 0.35s; }
        @supports (animation-timeline: view()) {
          .prod-fade {
            animation-timeline: view();
            animation-range: entry 0% entry 50%;
            animation-delay: 0s !important;
          }
        }

        .audience-card {
          background: var(--cream);
          border: 1px solid var(--rule);
          border-radius: 14px;
          padding: 32px;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1),
            box-shadow 0.35s cubic-bezier(0.2, 0.7, 0.2, 1),
            border-color 0.25s ease;
        }
        .audience-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 14px;
          background: linear-gradient(
            135deg,
            rgba(79, 107, 58, 0.08) 0%,
            transparent 60%
          );
          opacity: 0;
          transition: opacity 0.35s ease;
          pointer-events: none;
        }
        .audience-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 18px 40px rgba(20, 20, 19, 0.08);
          border-color: rgba(79, 107, 58, 0.35);
        }
        .audience-card:hover::before {
          opacity: 1;
        }
        .audience-card-icon {
          color: var(--green-deep);
          width: 28px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 18px;
          transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1);
        }
        .audience-card:hover .audience-card-icon {
          transform: scale(1.08) rotate(-2deg);
        }

        .trust-pillar {
          position: relative;
          padding-top: 14px;
        }
        .trust-pillar::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          width: 28px;
          height: 2px;
          background: var(--green);
          transform-origin: left center;
          transform: scaleX(0);
          animation: underline-grow 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) 0.2s
            forwards;
        }
        @supports (animation-timeline: view()) {
          .trust-pillar::before {
            animation: underline-grow 0.5s cubic-bezier(0.2, 0.7, 0.2, 1)
              forwards;
            animation-timeline: view();
            animation-range: entry 10% entry 60%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .prod-fade,
          .trust-pillar::before {
            opacity: 1;
            transform: none !important;
            animation: none !important;
          }
          .audience-card,
          .audience-card-icon {
            transition: none;
          }
        }
      `}</style>

      {/* HERO */}
      <section style={{ padding: "56px 0 32px" }}>
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
            Build. Ship. <em>Evolve.</em>
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
            From first prototype to production-grade software and beyond.
            Three phases. One team. Same engineer the whole way.
          </p>
        </div>
      </section>

      {/* AUDIENCE — Solo / Teams / Enterprise (moved up, with hover lift) */}
      <section
        className="r-section"
        style={{ borderTop: "none", paddingTop: 56 }}
      >
        <div className="r-wrap">
          <h2
            className="r-h-1 prod-fade"
            style={{
              textAlign: "center",
              margin: "0 auto 40px",
              fontSize: "clamp(28px, 3.2vw, 44px)",
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
              maxWidth: "22ch",
            }}
          >
            Built for every kind of <em>builder.</em>
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {AUDIENCES.map((a, i) => (
              <div
                key={a.tag}
                className={`audience-card prod-fade prod-fade-${i + 1}`}
              >
                <div className="audience-card-icon">{a.icon}</div>
                <span
                  style={{
                    alignSelf: "flex-start",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--green-deep)",
                    background: "var(--green-tint)",
                    padding: "4px 10px",
                    borderRadius: 999,
                    marginBottom: 18,
                  }}
                >
                  {a.tag}
                </span>
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
                  {a.title}
                </h3>
                <p className="r-tile-body" style={{ margin: 0 }}>
                  {a.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST — AI for speed. Engineers for trust. (moved up, ink band) */}
      <section
        style={{
          background: "var(--ink)",
          color: "var(--cream)",
          padding: "72px 0",
        }}
      >
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.3fr",
              gap: 64,
              alignItems: "start",
            }}
          >
            <div className="prod-fade">
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "rgba(244,242,238,0.5)",
                  marginBottom: 16,
                }}
              >
                Built to trust
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 400,
                  margin: "0 0 20px",
                  fontSize: "clamp(28px, 3vw, 40px)",
                  letterSpacing: "-0.018em",
                  lineHeight: 1.1,
                  maxWidth: "16ch",
                  color: "var(--cream)",
                }}
              >
                AI for speed.{" "}
                <em
                  style={{
                    color: "#a4c074",
                    fontStyle: "italic",
                  }}
                >
                  Engineers for trust.
                </em>
              </h2>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.65,
                  color: "rgba(244,242,238,0.78)",
                  maxWidth: "44ch",
                  margin: 0,
                }}
              >
                <RelayMark size={13} color="var(--cream)" /> is backed by
                operational depth, global delivery capability, and the
                engineering rigor of NINtec Systems. Continuity is not a
                feature. It is the foundation on which reliable software is
                built.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 32,
              }}
            >
              {TRUST_PILLARS.map((p, i) => (
                <div
                  key={p.title}
                  className={`trust-pillar prod-fade prod-fade-${i + 1}`}
                  style={{ color: "var(--cream)" }}
                >
                  <h4
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--cream)",
                      letterSpacing: "-0.005em",
                      margin: "0 0 10px",
                    }}
                  >
                    {p.title}
                  </h4>
                  <p
                    style={{
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      color: "rgba(244,242,238,0.72)",
                      margin: 0,
                    }}
                  >
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — auto-rotating 6-frame sequence */}
      <section className="r-section" style={{ borderTop: "none" }}>
        <div className="r-wrap">
          <HowItWorks />
        </div>
      </section>

      {/* MODALITIES — Chat / Voice / Screen share */}
      <section
        className="r-section"
        style={{
          background: "var(--paper)",
          borderTop: "1px solid var(--rule)",
        }}
      >
        <div className="r-wrap">
          <h2
            className="r-h-1"
            style={{
              textAlign: "center",
              margin: "0 auto",
              maxWidth: "24ch",
              fontSize: "clamp(26px, 2.8vw, 38px)",
              letterSpacing: "-0.018em",
              lineHeight: 1.1,
            }}
          >
            Chat. Voice. Screen share.
            <br />
            <em>One engineer. One team.</em>
          </h2>
          <div
            style={{
              marginTop: 48,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {MODALITIES.map((m, i) => (
              <div
                key={m.title}
                className={`audience-card prod-fade prod-fade-${i + 1}`}
                style={{ background: "var(--cream)" }}
              >
                <div className="audience-card-icon">{m.icon}</div>
                <h3
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontWeight: 600,
                    fontSize: 18,
                    letterSpacing: "-0.005em",
                    margin: "0 0 10px",
                    color: "var(--ink)",
                  }}
                >
                  {m.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: 0,
                  }}
                >
                  {m.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ON THE RECORD — 2-col intro + 4-up rail + compliance badges */}
      <section className="r-section">
        <div className="r-wrap">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: 56,
              alignItems: "center",
              marginBottom: 40,
            }}
          >
            <div className="prod-fade">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0,
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--ink-soft)",
                  marginBottom: 16,
                }}
              >
                <span>Relay</span>
                <span
                  className="r-mark-dot"
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "var(--green)",
                    display: "inline-block",
                    marginRight: 10,
                  }}
                ></span>
                <span>— On the record</span>
              </div>
              <h2
                className="r-h-1"
                style={{
                  margin: 0,
                  fontSize: "clamp(26px, 2.8vw, 38px)",
                  letterSpacing: "-0.018em",
                  lineHeight: 1.1,
                  maxWidth: "20ch",
                }}
              >
                Zoom-native sessions, recorded with consent.{" "}
                <em>Compliant by default.</em>
              </h2>
            </div>
            <p
              className="r-body prod-fade prod-fade-2"
              style={{
                margin: 0,
                maxWidth: "52ch",
                fontSize: 15,
                lineHeight: 1.6,
              }}
            >
              Every Relay session runs on Zoom — the tool your team already
              uses. We record (with consent), keep transcripts and code
              context tied to your project, and turn each conversation into
              something you can plan against and ship from. GDPR-aligned and
              built to enterprise compliance from day one.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 0,
              borderTop: "1px solid var(--rule)",
              borderBottom: "1px solid var(--rule)",
              background: "var(--cream)",
            }}
          >
            {SESSION_RAILS.map((s, i) => (
              <div
                key={s.num}
                className={`prod-fade prod-fade-${i + 1}`}
                style={{
                  padding: "32px 28px",
                  borderRight:
                    i < SESSION_RAILS.length - 1
                      ? "1px solid var(--rule)"
                      : "none",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--ink-mute)",
                    letterSpacing: "0.06em",
                    marginBottom: 14,
                  }}
                >
                  {s.num}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 400,
                    fontSize: 20,
                    lineHeight: 1.2,
                    letterSpacing: "-0.01em",
                    margin: "0 0 10px",
                    color: "var(--ink)",
                  }}
                >
                  {s.title}
                </h3>
                <p
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: "var(--ink-soft)",
                    margin: 0,
                  }}
                >
                  {s.body}
                </p>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 32,
              display: "flex",
              justifyContent: "center",
              gap: 8,
              flexWrap: "wrap",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--green-deep)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {[
              "GDPR",
              "SOC 2 posture",
              "Data residency",
              "Per-tenant isolation",
              "Consent on record",
              "DPA available",
            ].map((badge) => (
              <span
                key={badge}
                style={{
                  padding: "4px 12px",
                  background: "var(--green-tint)",
                  border: "1px solid rgba(79, 107, 58, 0.18)",
                  borderRadius: 999,
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="r-pull">
        <div className="r-wrap-narrow">
          <div className="r-pull-quote">
            Your engineer
            <br />
            becomes <em>your engineer.</em>
          </div>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            AI changed <em>who</em> can build.
            <br />
            Relay changes <em>the way</em> they ship.
          </h2>
          <p className="r-lede">
            Click the green dot. A real engineer joins in seconds. Stays
            with you to launch. Stays with you after.
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
            <button
              type="button"
              className="r-btn r-btn-ghost"
              style={{
                borderColor: "rgba(244,242,238,0.3)",
                color: "var(--cream)",
              }}
            >
              Talk to sales <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </section>
    </Shell>
  );
}
