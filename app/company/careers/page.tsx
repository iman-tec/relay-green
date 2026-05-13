/*
 * /company/careers — Hiring page.
 *
 * H1 + lede from the brief, then sections covering how we work, the bar,
 * three placeholder open roles in a tile grid, the interview loop, and
 * compensation philosophy. CTAs: see open roles, refer an engineer.
 */

import type { Metadata } from "next";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — Careers",
  description:
    "Engineers who like the moment a person walks in. Hiring senior engineers in New York, London, Bengaluru, and remote across fifteen time zones.",
};

const ROLES = [
  {
    num: "01",
    title: "Senior Engineer · Press",
    location: "NY · London · Bengaluru · Remote",
    body: "Pick up the press. Pair through to launch. Stay on for what comes after.",
  },
  {
    num: "02",
    title: "Bench Lead",
    location: "New York",
    body: "Run the rotation. Own match quality. Make sure the right person picks up the right press.",
  },
  {
    num: "03",
    title: "Engineering Manager",
    location: "London",
    body: "Build a team of seniors who like being on the line. Coach the bar without dulling it.",
  },
];

const SECTIONS = [
  {
    num: "01",
    title: "How we work",
    body: "Follow-the-sun, by construction. A senior engineer is on shift somewhere in the world every minute of every day. You work the hours of the bench you sit on; the press routes by region first.",
  },
  {
    num: "02",
    title: "The bar",
    body: "Senior, by every reasonable measure. Eight years if you count years; ten shipped systems if you count systems; a calm presence inside a stranger's IDE either way. Generalists who can read someone else's code without flinching.",
  },
  {
    num: "03",
    title: "How we interview",
    body: "Four conversations. One technical screen. One paired session against a real, anonymized Relay transcript. One bar-raiser. One with the founder you'll see most. No take-homes longer than ninety minutes.",
  },
  {
    num: "04",
    title: "Compensation philosophy",
    body: "Top-of-band cash for the city you're in. Equity that vests. Coverage that's actually coverage. We pay the same scale across countries, indexed locally — because the engineers do the same work.",
  },
];

export default function CareersPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap">
          <span className="r-num">— Company · Careers</span>
          <h1 className="r-h-display" style={{ marginTop: 18, maxWidth: "18ch" }}>
            Engineers who like the moment <em>a person walks in.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 28, maxWidth: "60ch" }}>
            We're hiring senior engineers in New York, London, Bengaluru, and
            remote across fifteen time zones. The job is to be the person on
            the other end of the press.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          <div className="r-tiles">
            {SECTIONS.map((s) => (
              <div className="r-tile" key={s.num}>
                <div className="r-tile-num">— {s.num}</div>
                <h3 className="r-tile-title">{s.title}</h3>
                <p className="r-tile-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          <div className="r-hero-eyebrow">
            <span className="r-num">— Open roles</span>
            <span
              style={{
                display: "inline-block",
                width: 20,
                height: 1,
                background: "currentColor",
                opacity: 0.4,
              }}
            ></span>
            <span
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontSize: 11,
              }}
            >
              Three open · More each month
            </span>
          </div>
          <h2 className="r-h-1" style={{ marginTop: 16, maxWidth: "22ch" }}>
            What we're hiring for <em>this quarter.</em>
          </h2>
          <div className="r-tiles" style={{ marginTop: 40 }}>
            {ROLES.map((r) => (
              <div className="r-tile" key={r.num}>
                <div className="r-tile-num">— {r.num}</div>
                <h3 className="r-tile-title">{r.title}</h3>
                <p
                  className="r-small"
                  style={{ margin: "0 0 10px", color: "var(--green)" }}
                >
                  {r.location}
                </p>
                <p className="r-tile-body">{r.body}</p>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 48,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <a
              href="mailto:support@relay.green"
              className="r-btn r-btn-ink"
            >
              See open roles <span className="arrow">→</span>
            </a>
            <a
              href="mailto:support@relay.green?subject=Engineer%20referral"
              className="r-btn r-btn-ghost"
            >
              Refer an engineer <span className="arrow">→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="r-cta-banner">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            The press is open <em>every minute of every day.</em>
          </h2>
          <p className="r-lede">
            Try the product you'd be building. Press the dot.
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
