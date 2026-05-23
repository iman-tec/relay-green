/*
 * /brand-guidelines, Relay Brand Guidelines v1.0.
 *
 * Recreates the design handoff (project/brand-guidelines.html) as a Next
 * server component. All visuals are scoped under .bg-root via the sibling
 * brand-guidelines.css file; no global tokens or fonts are mutated.
 */

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { RelayLogo } from "../_marketing/RelayLogo";
import "./brand-guidelines.css";

export const metadata: Metadata = {
  title: "Brand Guidelines",
  description:
    "What Relay looks like, sounds like, and does not do. The brand is the green dot.",
  alternates: { canonical: "/brand-guidelines" },
};

const markText: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
  letterSpacing: "0.04em",
};

const markDot = (extra: CSSProperties = {}): CSSProperties => ({
  width: 40,
  height: 40,
  marginLeft: 14,
  background: "var(--green)",
  transform: "none",
  ...extra,
});

const namingHeader: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "200px 1fr 1fr",
  gap: 24,
  padding: "16px 0",
  borderBottom: "1px solid var(--rule)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--ink-mute)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const namingRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "200px 1fr 1fr",
  gap: 24,
  padding: "20px 0",
  borderBottom: "1px solid var(--rule)",
};

const namingConcept: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 17,
};

const namingSay: CSSProperties = { fontSize: 14, color: "var(--ink)" };
const namingNot: CSSProperties = { fontSize: 14, color: "var(--ink-mute)" };

export default function BrandGuidelinesPage() {
  return (
    <div className="bg-root">
      <nav className="bg-nav">
        <div className="bg-nav-inner">
          <a href="#brand" className="bg-logo">
            Relay<span className="bg-logo-dot"></span>
          </a>
          <div className="bg-nav-toc">
            <a href="#brand">Brand</a>
            <a href="#mark">Mark</a>
            <a href="#color">Color</a>
            <a href="#type">Type</a>
            <a href="#voice">Voice</a>
            <a href="#components">Components</a>
            <a href="#layout">Layout</a>
          </div>
          <Link href="/" className="bg-back">
            ← Back to site
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <header className="bg-hero" id="brand">
        <div className="wrap">
          <div className="bg-eyebrow">Brand Guidelines · v1.0 · May 2026</div>
          <h1>
            The brand is the <em>green dot.</em>
          </h1>
          <p>
            Relay is the irreducibly human moment between AI’s automation and a
            builder’s confusion. The mark is calm. The voice is plain. The dot
            is the promise. This document codifies what the brand looks like,
            sounds like, and does not do, so that everyone who builds for Relay
            builds it the same way.
          </p>
          <div className="bg-hero-meta">
            <div>
              <b>Owner</b>Brand · Relay TechnoForge, Inc.
            </div>
            <div>
              <b>Status</b>Living document
            </div>
            <div>
              <b>Audience</b>Design, Eng, Marketing, Sales, Partners
            </div>
            <div>
              <b>Cadence</b>Reviewed quarterly
            </div>
          </div>
        </div>
      </header>

      {/* 01 BRAND ESSENCE */}
      <section className="bg-section">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">01, Essence</div>
            </div>
            <div>
              <h2>
                What Relay <em>actually is.</em>
              </h2>
              <p className="lede">
                Read this once. Everything else in this document follows from
                it. If a design, a line of copy, or a feature decision
                contradicts the essence, it’s wrong, even if it looks great.
              </p>
            </div>
          </div>

          <div className="bg-grid-3">
            <div className="bg-tile">
              <div className="bg-tile-num">Promise</div>
              <h4>Build with AI. Ship with engineers.</h4>
              <p>
                One tap. One software engineer. One promise, a real person, by
                name and face, joins in seconds and stays through launch.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Position</div>
              <h4>Software-as-a-Service has a Service in it again.</h4>
              <p>
                Relay restores the human half of SaaS. Not a chatbot, not a
                forum, not a marketplace. A software engineer who stays from build
                to shipped to running.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Personality</div>
              <h4>Calm. Plain-spoken. Quietly confident.</h4>
              <p>
                We sound like a software engineer at a whiteboard, not a tech
                company at a launch event. No exclamation marks. No
                “revolutionize.” No emoji.
              </p>
            </div>
          </div>

          <div
            style={{
              marginTop: 56,
              padding: 48,
              background: "var(--ink)",
              color: "var(--cream)",
              borderRadius: 16,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "rgba(244,242,238,0.5)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: 24,
              }}
            >
              The one-line test
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 3.4vw, 44px)",
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
                maxWidth: "24ch",
              }}
            >
              Would a software engineer say this{" "}
              <em style={{ fontStyle: "italic", color: "#6FCF87" }}>
                out loud,
              </em>{" "}
              with a straight face, to another engineer?
            </div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                color: "rgba(244,242,238,0.7)",
                marginTop: 24,
                maxWidth: "60ch",
              }}
            >
              If yes, ship it. If not, rewrite it. This applies to headlines,
              button labels, error messages, sales decks, everything.
            </div>
          </div>
        </div>
      </section>

      {/* 02 MARK */}
      <section className="bg-section" id="mark">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">02, Mark</div>
            </div>
            <div>
              <h2>
                Wordmark + <em>green dot.</em>
              </h2>
              <p className="lede">
                The mark is a word and a dot. RELAY set in uppercase sans,
                tracked open, with a single perfect circle in Relay Green
                sitting one space after. The word is the company. The dot is the
                press. Together they are the entire system.
              </p>
            </div>
          </div>

          <div className="bg-lockup-board">
            <span className="bg-mark-large" style={markText}>
              RELAY
              <span
                className="dot"
                style={{
                  width: "0.72em",
                  height: "0.72em",
                  marginLeft: "0.22em",
                  background: "var(--green)",
                  verticalAlign: "baseline",
                  transform: "none",
                }}
              ></span>
            </span>
          </div>

          <div className="bg-mark-grid">
            <div className="bg-mark-cell">
              <span className="label">Primary · Cream</span>
              <span
                className="bg-mark-large"
                style={{ ...markText, fontSize: 56 }}
              >
                RELAY<span className="dot" style={markDot()}></span>
              </span>
            </div>
            <div className="bg-mark-cell dark">
              <span className="label">Reverse · Ink</span>
              <span
                className="bg-mark-large"
                style={{ ...markText, fontSize: 56, color: "var(--cream)" }}
              >
                RELAY<span className="dot" style={markDot()}></span>
              </span>
            </div>
            <div className="bg-mark-cell green">
              <span className="label">Green block · sparingly</span>
              <span
                className="bg-mark-large"
                style={{ ...markText, fontSize: 56, color: "var(--cream)" }}
              >
                RELAY
                <span
                  className="dot"
                  style={markDot({ background: "var(--cream)" })}
                ></span>
              </span>
            </div>
            <div className="bg-mark-cell dot-only">
              <span className="label">
                Dot alone · favicon, app icon, badge
              </span>
              <span className="bg-dot-pulse"></span>
            </div>
          </div>

          <div className="bg-grid-2" style={{ marginTop: 56 }}>
            <div>
              <div className="bg-section-num" style={{ marginBottom: 16 }}>
                Do
              </div>
              <div className="bg-do">
                Use the wordmark with a single dot, always at the
                baseline-period position.
              </div>
              <div className="bg-do">
                Maintain clear space equal to the dot diameter on all sides.
              </div>
              <div className="bg-do">
                Animate the dot with a subtle pulse only when it represents an
                active “press for a human” moment.
              </div>
              <div className="bg-do">
                Use the dot alone (no word) for app icons, favicons, status
                indicators, and merchandise.
              </div>
            </div>
            <div>
              <div className="bg-section-num" style={{ marginBottom: 16 }}>
                Don&apos;t
              </div>
              <div className="bg-dont">
                Don’t add a tagline lockup. The mark stands alone.
              </div>
              <div className="bg-dont">
                Don’t enclose the mark in a shape, badge, or container.
              </div>
              <div className="bg-dont">
                Don’t recolor the dot to anything other than Relay Green (or
                cream, on a green field).
              </div>
              <div className="bg-dont">
                Don’t animate the dot decoratively, it pulses to mean something,
                never to look interesting.
              </div>
              <div className="bg-dont">
                Don’t spell it “relay.green” in the mark. The URL is the URL;
                the brand is “Relay.”
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 03 COLOR */}
      <section className="bg-section" id="color">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">03, Color</div>
            </div>
            <div>
              <h2>
                Cream and ink, with a <em>single green.</em>
              </h2>
              <p className="lede">
                The palette is two warm neutrals and one earned green. Green is
                reserved for the dot, for state changes the user caused
                (“Engineer joined”), and for the act of human contact. Never
                decorative. If you find yourself reaching for green, ask whether
                a human is involved.
              </p>
            </div>
          </div>

          <div className="bg-eyebrow" style={{ marginBottom: 16 }}>
            Primary tokens
          </div>
          <div className="bg-color-grid">
            <Swatch name="Cream" token="--cream" hex="#F4F2EE" fill="#f0eee9">
              Default page background. Warm, paper-like. Sets the editorial tone
              of the brand.
            </Swatch>
            <Swatch name="Ink" token="--ink" hex="#1A1814" fill="#1a1814">
              Body text, primary buttons, dark sections. Almost-but-not-quite
              black, warm-tinted.
            </Swatch>
            <Swatch
              name="Moss"
              token="--green-bright"
              hex="#4F6B3A"
              fill="#4d6b40"
            >
              The brand. The dot. Human presence. Use sparingly, it is the only
              color that earns attention.
            </Swatch>
            <Swatch
              name="Deep Moss"
              token="--green-deep"
              hex="#3F5C2E"
              fill="#3f5c34"
            >
              Italic emphasis in serif headlines. Hyperlink color. Accessible on
              cream.
            </Swatch>
          </div>

          <div className="bg-eyebrow" style={{ margin: "56px 0 16px" }}>
            Surface + support
          </div>
          <div className="bg-color-grid">
            <Swatch name="Paper" token="--paper" hex="#F9F7F3" fill="#f9f7f3">
              Card and tile surface. Half-step lighter than cream.
            </Swatch>
            <Swatch
              name="Cream-2"
              token="--cream-2"
              hex="#ECE8E0"
              fill="#ece8e0"
            >
              Alternate section background. Differentiating two-up splits.
            </Swatch>
            <Swatch name="Rule" token="--rule" hex="#D8D2C5" fill="#d8d2c5">
              Hairlines, dividers, card borders. Never as a fill.
            </Swatch>
            <Swatch
              name="Green Tint"
              token="--green-tint"
              hex="#E6F4EA"
              fill="#e6f4ea"
            >
              Background for “baton pass” cards and successful-action
              notifications.
            </Swatch>
          </div>

          <div
            style={{
              marginTop: 56,
              padding: 32,
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              borderRadius: 12,
            }}
          >
            <div className="bg-section-num" style={{ marginBottom: 16 }}>
              The 80/15/5 rule
            </div>
            <p
              style={{
                fontSize: 16,
                color: "var(--ink-soft)",
                maxWidth: "70ch",
              }}
            >
              On any given screen:{" "}
              <strong style={{ color: "var(--ink)" }}>80% cream / paper</strong>{" "}
              as background,{" "}
              <strong style={{ color: "var(--ink)" }}>15% ink</strong> as type
              and structure,{" "}
              <strong style={{ color: "var(--green-deep)" }}>5% green</strong>{" "}
              as the moment of human contact. If your green creeps above 5%,
              you’re using it as decoration, not as meaning.
            </p>
          </div>
        </div>
      </section>

      {/* 04 TYPE */}
      <section className="bg-section" id="type">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">04, Typography</div>
            </div>
            <div>
              <h2>
                Serif for the <em>promise.</em>
                <br />
                Sans for the work.
              </h2>
              <p className="lede">
                Display and body in Source Serif 4, the editorial serif that
                mirrors anthropic.com&rsquo;s house feel, calm, authoritative,
                no flourishes. UI and eyebrows in Inter, the neutral grotesque
                that sits quietly behind the type. Mono in JetBrains for code
                and numerical labels. Three families. Done.
              </p>
            </div>
          </div>

          <div className="bg-type-row">
            <div className="bg-type-meta">
              Display
              <div>Source Serif 4 · 400 / italic</div>
              <div>Clamp 32–56px</div>
            </div>
            <div className="bg-type-display">
              Build with AI.
              <br />
              Ship with <em>engineers.</em>
            </div>
          </div>
          <div className="bg-type-row">
            <div className="bg-type-meta">
              Heading 1<div>Source Serif 4 · 400</div>
              <div>48px / -0.018em</div>
            </div>
            <div className="bg-type-h1">
              Your engineer becomes <em>your engineer.</em>
            </div>
          </div>
          <div className="bg-type-row">
            <div className="bg-type-meta">
              Heading 2<div>Source Serif 4 · 400</div>
              <div>32px / -0.014em</div>
            </div>
            <div className="bg-type-h2">
              From build to shipped, with the same engineer.
            </div>
          </div>
          <div className="bg-type-row">
            <div className="bg-type-meta">
              Eyebrow<div>JetBrains Mono · 500</div>
              <div>12px / 0.05em / UPPER</div>
            </div>
            <div className="bg-type-eyebrow">How it works · 06 frames</div>
          </div>
          <div className="bg-type-row">
            <div className="bg-type-meta">
              Body<div>Source Serif 4 · 400</div>
              <div>17px / 1.65</div>
            </div>
            <div className="bg-type-body">
              Software is following the path coal once did: when a thing gets
              cheaper, we use a lot more of it. AI dev tools were supposed to
              reduce demand for engineers, instead they multiplied builders by
              an order of magnitude.
            </div>
          </div>
          <div className="bg-type-row">
            <div className="bg-type-meta">
              Caption<div>Inter · 400</div>
              <div>14px / 1.55</div>
            </div>
            <div className="bg-type-small">
              Median time-to-human · 74 seconds in beta. Priority dispatch on
              Max plan targets 30 seconds.
            </div>
          </div>

          <div className="bg-grid-2" style={{ marginTop: 56 }}>
            <div>
              <div className="bg-section-num" style={{ marginBottom: 16 }}>
                Italic, with intent
              </div>
              <div className="bg-do">
                Italics in Source Serif 4 are reserved for{" "}
                <em>the human moment</em> in a sentence. They mark the part
                where Relay is the answer.
              </div>
              <div className="bg-do">
                Italics carry Deep Moss color (#3F5C2E) in headlines. Never in
                body copy.
              </div>
            </div>
            <div>
              <div className="bg-section-num" style={{ marginBottom: 16 }}>
                Mono numerals
              </div>
              <div className="bg-do">
                Use{" "}
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                  }}
                >
                  font-variant-numeric: tabular-nums
                </code>{" "}
                on stat blocks so digits align column-to-column.
              </div>
              <div className="bg-do">
                Eyebrows always lead with an em-dash and end with a section
                number:{" "}
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                  }}
                >
                  Pricing · 03
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 05 VOICE */}
      <section className="bg-section" id="voice">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">05, Voice</div>
            </div>
            <div>
              <h2>
                Plain words, <em>fewer of them.</em>
              </h2>
              <p className="lede">
                Imagine a software engineer explaining the product to a friend on
                a Sunday walk. That’s the register. Direct, slightly
                understated, occasionally dry. We never sell, we describe what
                is true. The product does the convincing.
              </p>
            </div>
          </div>

          <div className="bg-voice-grid">
            <VoiceCard tone="do">
              Build with AI. Ship with <em>engineers.</em>
            </VoiceCard>
            <VoiceCard tone="dont">
              Revolutionize your workflow with the world’s first AI-native human
              assistance platform!
            </VoiceCard>
            <VoiceCard tone="do">
              Same engineer. Three legs. <em>One relationship.</em>
            </VoiceCard>
            <VoiceCard tone="dont">
              End-to-end engineer continuity across the full development
              lifecycle.
            </VoiceCard>
            <VoiceCard tone="do">
              Your team is already building.{" "}
              <em>Make sure it doesn’t break.</em>
            </VoiceCard>
            <VoiceCard tone="dont">
              Empower your enterprise with AI governance solutions for citizen
              developers.
            </VoiceCard>
          </div>

          <div className="bg-grid-3" style={{ marginTop: 56 }}>
            <div className="bg-tile">
              <div className="bg-tile-num">Lexicon · use</div>
              <h4>
                builder · ship · pass the baton · same engineer · on demand ·
                ready
              </h4>
              <p>
                Words that come from how the work actually feels. Specific,
                concrete, drawn from the user’s mouth.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Lexicon · avoid</div>
              <h4>
                solution · empower · revolutionize · seamless · world-class ·
                cutting-edge
              </h4>
              <p>
                Boilerplate B2B vocabulary. If a competitor could say it, we
                don’t.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Punctuation</div>
              <h4>
                Em-dash, sparingly. No exclamation marks. Periods earn the line.
              </h4>
              <p>
                Sentences are short. Paragraphs are short. White space is part
                of the message.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 06 COMPONENTS */}
      <section className="bg-section" id="components">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">06, Components</div>
            </div>
            <div>
              <h2>
                Five primitives. <em>That’s the kit.</em>
              </h2>
              <p className="lede">
                Buttons, the press-for-a-human button, the engineer card, the
                modality toggle, and the numbered tile. Everything else is
                composition. Resist adding a sixth.
              </p>
            </div>
          </div>

          <div className="bg-comp-grid">
            <div className="bg-comp-cell">
              <span className="bg-mark-cell-label">Button · Ink (default)</span>
              <button type="button" className="bg-btn bg-btn-ink">
                Get in touch <span>→</span>
              </button>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  marginTop: 16,
                }}
              >
                Primary CTA in body sections. Pill, 40px tall.
              </p>
            </div>
            <div className="bg-comp-cell">
              <span className="bg-mark-cell-label">
                Button · Green (the moment)
              </span>
              <button type="button" className="bg-btn bg-btn-green">
                Try Relay <span>→</span>
              </button>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  marginTop: 16,
                }}
              >
                Reserved for the act of summoning a human.
              </p>
            </div>
            <div className="bg-comp-cell">
              <span className="bg-mark-cell-label">Button · Ghost</span>
              <button type="button" className="bg-btn bg-btn-ghost">
                See the kit <span>→</span>
              </button>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  marginTop: 16,
                }}
              >
                Secondary action. Always paired with a primary.
              </p>
            </div>
            <div className="bg-comp-cell" style={{ gridColumn: "span 2" }}>
              <span className="bg-mark-cell-label">
                Press-for-a-human (the hero CTA)
              </span>
              <button type="button" className="bg-press">
                <span className="dot"></span> Press for a human
              </button>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  marginTop: 16,
                }}
              >
                The single most important component. Used once per screen, max.
                Pulses on hover. Means something.
              </p>
            </div>
            <div className="bg-comp-cell">
              <span className="bg-mark-cell-label">Engineer card</span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  background: "var(--cream)",
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  width: "100%",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--ink)",
                    color: "var(--cream)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-display)",
                    fontSize: 16,
                    position: "relative",
                  }}
                >
                  P
                  <span
                    style={{
                      position: "absolute",
                      bottom: -2,
                      right: -2,
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "var(--green)",
                      border: "2px solid var(--cream)",
                    }}
                  ></span>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Priya R. · Stripe
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                    Online · joined in 71s
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 07 LAYOUT */}
      <section className="bg-section" id="layout">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">07, Layout & Spacing</div>
            </div>
            <div>
              <h2>
                Air, then density. <em>Never the reverse.</em>
              </h2>
              <p className="lede">
                Every section starts with vast top-padding and an eyebrow.
                Content sits in a 1200px max-width container with 32px gutters.
                Headlines don’t fill the column, they wrap intentionally, around
                an idea.
              </p>
            </div>
          </div>

          <div className="bg-eyebrow" style={{ marginBottom: 16 }}>
            Spacing scale (8pt base)
          </div>
          <div>
            <SpaceRow size={4} token="--sp-1" />
            <SpaceRow size={8} token="--sp-2" />
            <SpaceRow size={16} token="--sp-4" />
            <SpaceRow size={24} token="--sp-6" />
            <SpaceRow size={32} token="--sp-8" />
            <SpaceRow size={48} token="--sp-12" />
            <SpaceRow size={64} token="--sp-16" />
            <SpaceRow size={96} token="--sp-24" />
            <SpaceRow size={128} token="--sp-32" />
          </div>

          <div className="bg-grid-3" style={{ marginTop: 56 }}>
            <div className="bg-tile">
              <div className="bg-tile-num">Section rhythm</div>
              <h4>96 / 100 / 128</h4>
              <p>
                Sections breathe. Top padding is 100–128px. Anything tighter
                feels like marketing software, not editorial.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Containers</div>
              <h4>1200 / 820 / 32</h4>
              <p>
                1200px primary container. 820px narrow container for long-form
                prose. 32px gutter on both sides.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Radii</div>
              <h4>8 · 12 · 16 · 999</h4>
              <p>
                Cards: 12px. Hero panels: 16px. Buttons: full pill (999). Don’t
                mix radii within a composition.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 08 IMAGERY + MOTION */}
      <section className="bg-section">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">08, Imagery & Motion</div>
            </div>
            <div>
              <h2>
                Faces, not <em>illustrations.</em>
              </h2>
              <p className="lede">
                When we show a human, we show a real one, first name, photo,
                expertise. We never use stock illustration, never use 3D
                abstract shapes, never use AI-generated faces. The product is
                humans; the brand should look like it.
              </p>
            </div>
          </div>

          <div className="bg-grid-2">
            <div className="bg-tile">
              <div className="bg-tile-num">Imagery rules</div>
              <h4>Documentary, not directed.</h4>
              <p style={{ marginBottom: 12 }}>
                Engineer photos are square crops, ink-and-cream toned, with a
                green dot status bug at the bottom-right. Backgrounds neutral.
                No corporate-stock smiles.
              </p>
              <p>
                Product UI is shown the way it actually looks, in real terminal
                windows, real chat threads, real code. Never “futuristic”
                mockups.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">Motion principles</div>
              <h4>Pulse means presence. Everything else is still.</h4>
              <p style={{ marginBottom: 12 }}>
                The dot pulses at 2s ease-in-out, ±20% scale. That motion is the
                brand. Reserve it for active “a human is here” states.
              </p>
              <p>
                Transitions are 200ms, ease-out. Page changes are instant
                scroll-to-top. We don’t do parallax, we don’t do
                scroll-triggered reveals, we don’t do auto-playing video.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 09 ARCHITECTURE */}
      <section className="bg-section">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">09, Naming & Architecture</div>
            </div>
            <div>
              <h2>
                What things are called, <em>and what they aren’t.</em>
              </h2>
              <p className="lede">
                A product’s vocabulary is part of its design. Get the words
                right once, and every team uses them the same way forever.
              </p>
            </div>
          </div>

          <div style={namingHeader}>
            <div>Concept</div>
            <div>Say this</div>
            <div>Not this</div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The brand name</div>
            <div style={namingSay}>
              <RelayLogo />
            </div>
            <div style={namingNot}>
              relay.green, Relay.Green, ReLay, Relay AI
            </div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The promise</div>
            <div style={namingSay}>Build with AI. Ship with engineers.</div>
            <div style={namingNot}>
              A real engineer, in your AI build / The press for a person / From
              build to shipped
            </div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The CTA</div>
            <div style={namingSay}>Try Relay / Press for a human</div>
            <div style={namingNot}>Get started / Sign up / Request a demo</div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The user</div>
            <div style={namingSay}>Builder</div>
            <div style={namingNot}>
              Citizen developer / Vibe coder / Non-developer / Customer
            </div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The expert</div>
            <div style={namingSay}>Engineer (always by name)</div>
            <div style={namingNot}>
              Agent / Operator / Specialist / Consultant / Pro
            </div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The session</div>
            <div style={namingSay}>Session / Build moment</div>
            <div style={namingNot}>Ticket / Chat / Conversation / Inquiry</div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The handoff</div>
            <div style={namingSay}>Pass the baton (Leg 1 → 2 → 3)</div>
            <div style={namingNot}>Upsell / Conversion / Plan upgrade</div>
          </div>
          <div style={namingRow}>
            <div style={namingConcept}>The categories</div>
            <div style={namingSay}>
              Track (Claude track, Cursor track, Lovable track…)
            </div>
            <div style={namingNot}>Vertical / Practice / Channel / Pillar</div>
          </div>
          <div style={{ ...namingRow, borderBottom: "none" }}>
            <div style={namingConcept}>The promise time</div>
            <div style={namingSay}>On demand</div>
            <div style={namingNot}>Instant / Real-time / Lightning-fast</div>
          </div>
        </div>
      </section>

      {/* 10 INDEPENDENCE */}
      <section className="bg-section">
        <div className="wrap">
          <div className="bg-section-head">
            <div>
              <div className="bg-section-num">10, Independence & posture</div>
            </div>
            <div>
              <h2>
                A new company. <em>By design.</em>
              </h2>
              <p className="lede">
                Relay is an independent company. We don’t lead with org charts,
                parent companies, or anyone’s logo but our own. The brand stands
                on the press, the engineer, the moment of relief.
              </p>
            </div>
          </div>

          <div className="bg-grid-2">
            <div className="bg-tile">
              <div className="bg-tile-num">What we say about ourselves</div>
              <h4>Independent</h4>
              <p>
                “Relay TechnoForge, Inc., independent.” That’s the full corporate line.
                Anything more belongs in legal, not on the page.
              </p>
            </div>
            <div className="bg-tile">
              <div className="bg-tile-num">What we don’t do</div>
              <h4>No backers in the wordmark. No logos in the hero.</h4>
              <p>
                Investors and partners are mentioned where it’s honest to
                mention them, never as a credibility crutch in the marketing
                surface. The press and the engineer carry the brand.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-foot">
        <div className="wrap">
          <div className="bg-foot-bar">
            <span>Relay Brand Guidelines · v1.0 · May 2026</span>
            <span>Living document · Reviewed quarterly</span>
            <Link href="/">← Back to site</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Swatch({
  name,
  token,
  hex,
  fill,
  children,
}: {
  name: string;
  token: string;
  hex: string;
  fill: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-swatch">
      <div className="bg-swatch-fill" style={{ background: fill }}></div>
      <div className="bg-swatch-meta">
        <div className="bg-swatch-name">{name}</div>
        <div className="bg-swatch-tok">{token}</div>
        <div className="bg-swatch-hex">{hex}</div>
        <div className="bg-swatch-use">{children}</div>
      </div>
    </div>
  );
}

function VoiceCard({
  tone,
  children,
}: {
  tone: "do" | "dont";
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-voice-card ${tone}`}>
      <div className="bg-voice-tag">{tone === "do" ? ", Yes" : ", No"}</div>
      <div className="bg-voice-line">{children}</div>
    </div>
  );
}

function SpaceRow({ size, token }: { size: number; token: string }) {
  return (
    <div className="bg-space-row">
      <span>{size}</span>
      <span className="tok">{token}</span>
      <div className="bg-space-bar" style={{ width: size }}></div>
    </div>
  );
}
