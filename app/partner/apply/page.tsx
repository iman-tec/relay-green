/*
 * /partner/apply — public "become a partner" landing + application.
 *
 * Unauthenticated marketing surface (NOT the /partner login — this captures
 * an application, it is not a way in). Sell, then capture, in one scroll:
 * hero (the marketing clip + self-interest headline) → concrete economics →
 * low-effort onboarding → tier/badge upside → qualitative proof → the lean
 * form (ApplyForm, client). Brand: marketing Shell + --green editorial tokens,
 * same as /for-enterprise. Proof is qualitative only — no fabricated stats.
 *
 * Not flag-gated: top-of-funnel, exposes no authed data (see
 * docs/audit/partner-apply-findings.md §6). The reused clip is the same source
 * as the /partner login proof panel.
 */

import type { Metadata } from "next";
import { Shell } from "../../_marketing/Shell";
import { ApplyForm } from "./ApplyForm";

export const metadata: Metadata = {
  title: "Become a Relay partner",
  description:
    "Resell the senior engineering support your clients already need — on your margin. A 20% wholesale pool, you set the passthrough, margin accrues as clients use Relay. Apply to the Relay channel partner program.",
  alternates: { canonical: "/partner/apply" },
};

// Concrete economics — three steps, qualitative (no invented numbers beyond
// the real 20% wholesale pool the program runs on).
const ECONOMICS: { k: string; title: string; body: string }[] = [
  {
    k: "01",
    title: "A 20% wholesale pool",
    body: "Relay gives you a 20% wholesale discount on every minute your clients buy. That discount is your ceiling — the room you have to price.",
  },
  {
    k: "02",
    title: "You set the passthrough",
    body: "Pass some of the discount to the client to win the deal, keep the rest. The spread between your wholesale rate and what the client pays is your margin.",
  },
  {
    k: "03",
    title: "Margin accrues passively",
    body: "You don't run billing or invoice minutes. As your clients use Relay, your margin accrues automatically against their usage. Paid out on your ledger.",
  },
];

// Low-effort — the operational pitch: two fields, discount auto-applies.
const LOW_EFFORT: string[] = [
  "Onboard a client company in two fields — name and admin email. That's the whole setup.",
  "Their discount applies automatically at checkout. You never touch a price or an invoice.",
  "You don't run billing, collections, or support — Relay does. You hold the relationship.",
];

// Tier + badge upside, qualitative only.
const TIERS: { name: string; body: string }[] = [
  {
    name: "Partner",
    body: "Where everyone starts. Full 20% wholesale pool, the portal, your reseller code, and client onboarding from day one.",
  },
  {
    name: "Premier",
    body: "Earned by the book of business you bring. A premier badge on your portal and priority partner support — one transparent metric, no fine print.",
  },
];

export default function PartnerApplyPage() {
  return (
    <Shell>
      {/* HERO — the marketing clip + the partner-self-interest headline.
          Same video source as the /partner login proof panel. */}
      <section style={{ padding: "72px 0 56px", background: "var(--paper)" }}>
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 48,
              alignItems: "center",
            }}
          >
            <div>
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
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--green)",
                    display: "inline-block",
                  }}
                />
                Relay channel partner program
              </div>

              <h1
                className="r-h-display"
                style={{
                  margin: "0 0 22px",
                  fontSize: "clamp(32px, 4.2vw, 54px)",
                  letterSpacing: "-0.032em",
                  lineHeight: 1.05,
                  textWrap: "balance",
                  color: "var(--ink)",
                }}
              >
                Resell the senior engineering support your clients already need
                —{" "}
                <em style={{ color: "var(--green)", fontStyle: "italic" }}>
                  on your margin.
                </em>
              </h1>

              <p
                style={{
                  margin: "0 0 28px",
                  fontSize: "clamp(16px, 1.35vw, 20px)",
                  lineHeight: 1.5,
                  color: "var(--ink-soft)",
                  maxWidth: "52ch",
                }}
              >
                Your clients are building with AI and hitting walls. Relay puts
                a qualified engineer behind every AI-built system in seconds.
                You resell it on a 20% wholesale pool, set your own passthrough,
                and keep the spread — no billing to run.
              </p>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <a
                  href="#apply"
                  className="r-btn r-btn-green"
                  style={{ textDecoration: "none" }}
                >
                  Apply to partner{" "}
                  <span className="arrow" aria-hidden="true">
                    →
                  </span>
                </a>
                <a
                  href="/partner"
                  className="r-btn r-btn-ghost"
                  style={{ textDecoration: "none" }}
                >
                  Already a partner? Sign in
                </a>
              </div>
            </div>

            <div>
              <video
                src="/relay-explainer-final-v5.mp4"
                controls
                preload="metadata"
                poster="/relay-explainer-v6-poster.jpg"
                className="w-full"
                style={{
                  width: "100%",
                  borderRadius: 16,
                  border: "1px solid var(--rule)",
                  aspectRatio: "16 / 10",
                  boxShadow:
                    "0 1px 2px rgba(0,0,0,0.035), 0 22px 64px rgba(0,0,0,0.08)",
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ECONOMICS — concrete, three steps. */}
      <section style={{ padding: "80px 0", background: "var(--cream-2)" }}>
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h2
            className="r-h-1"
            style={{
              margin: "0 0 8px",
              fontSize: "clamp(28px, 3vw, 44px)",
              letterSpacing: "-0.028em",
              lineHeight: 1.05,
              color: "var(--ink)",
              textWrap: "balance",
            }}
          >
            The economics,{" "}
            <em style={{ color: "var(--green-deep)" }}>concrete.</em>
          </h2>
          <p
            style={{
              margin: "0 0 40px",
              fontSize: 16,
              color: "var(--ink-soft)",
              maxWidth: "56ch",
              lineHeight: 1.6,
            }}
          >
            One wholesale pool, your spread, margin that accrues while you
            sleep.
          </p>

          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 16,
            }}
          >
            {ECONOMICS.map((e) => (
              <div
                key={e.k}
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  borderRadius: 12,
                  padding: 28,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--green-deep)",
                    letterSpacing: "0.06em",
                    marginBottom: 16,
                  }}
                >
                  {e.k}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: 19,
                    lineHeight: 1.2,
                    letterSpacing: "-0.01em",
                    margin: "0 0 10px",
                    color: "var(--ink)",
                  }}
                >
                  {e.title}
                </h3>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: 0,
                  }}
                >
                  {e.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LOW EFFORT — operational pitch. */}
      <section style={{ padding: "80px 0", background: "var(--paper)" }}>
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
              gap: 48,
              alignItems: "center",
            }}
          >
            <h2
              className="r-h-1"
              style={{
                margin: 0,
                fontSize: "clamp(28px, 3vw, 44px)",
                letterSpacing: "-0.028em",
                lineHeight: 1.05,
                color: "var(--ink)",
                textWrap: "balance",
              }}
            >
              Two fields to onboard a client.{" "}
              <em style={{ color: "var(--green)" }}>
                You run none of the billing.
              </em>
            </h2>

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {LOW_EFFORT.map((line, i) => (
                <li
                  key={line}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr",
                    gap: 14,
                    alignItems: "start",
                    padding: "16px 0",
                    borderBottom:
                      i < LOW_EFFORT.length - 1
                        ? "1px solid var(--rule)"
                        : "none",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: "var(--green)",
                      display: "inline-block",
                      marginTop: 8,
                    }}
                  />
                  <p
                    style={{
                      margin: 0,
                      fontSize: 16,
                      lineHeight: 1.55,
                      color: "var(--ink)",
                    }}
                  >
                    {line}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* TIER + BADGE upside (qualitative). */}
      <section style={{ padding: "80px 0", background: "var(--cream-2)" }}>
        <div className="r-wrap" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h2
            className="r-h-1"
            style={{
              margin: "0 0 40px",
              fontSize: "clamp(28px, 3vw, 44px)",
              letterSpacing: "-0.028em",
              lineHeight: 1.05,
              color: "var(--ink)",
            }}
          >
            The program in{" "}
            <em style={{ color: "var(--green-deep)" }}>one glance.</em>
          </h2>
          <div
            className="r-grid-collapse-md"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 16,
            }}
          >
            {TIERS.map((t) => (
              <div
                key={t.name}
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--rule)",
                  borderRadius: 12,
                  padding: 30,
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--green-deep)",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    marginBottom: 18,
                  }}
                >
                  {t.name}
                </div>
                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--ink-soft)",
                    margin: 0,
                  }}
                >
                  {t.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROOF — qualitative trust copy only, no fabricated stats/logos. */}
      <section style={{ padding: "80px 0", background: "var(--paper)" }}>
        <div
          className="r-wrap-narrow"
          style={{ maxWidth: 760, margin: "0 auto" }}
        >
          <p
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(22px, 2.4vw, 32px)",
              fontWeight: 400,
              lineHeight: 1.35,
              letterSpacing: "-0.015em",
              color: "var(--ink)",
              textAlign: "center",
              margin: 0,
              textWrap: "balance",
            }}
          >
            The senior engineering layer your clients keep asking for is the
            same one you can now put your name on.{" "}
            <em style={{ color: "var(--green-deep)" }}>
              One coherent pitch, one margin, no rebuilds.
            </em>
          </p>
        </div>
      </section>

      {/* THE APPLICATION. */}
      <section style={{ padding: "8px 0 96px", background: "var(--paper)" }}>
        <div
          className="r-wrap-narrow"
          style={{ maxWidth: 720, margin: "0 auto" }}
        >
          <h2
            className="r-h-1"
            style={{
              margin: "0 0 6px",
              fontSize: "clamp(26px, 2.8vw, 38px)",
              letterSpacing: "-0.024em",
              lineHeight: 1.08,
              color: "var(--ink)",
            }}
          >
            Apply to become a partner
          </h2>
          <p
            style={{
              margin: "0 0 28px",
              fontSize: 15,
              color: "var(--ink-soft)",
              lineHeight: 1.6,
              maxWidth: "56ch",
            }}
          >
            A short application — we qualify the rest on a quick call. We reply
            within two business days.
          </p>
          <ApplyForm />
        </div>
      </section>
    </Shell>
  );
}
