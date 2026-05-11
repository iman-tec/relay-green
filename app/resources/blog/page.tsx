/*
 * /resources/blog — index of published essays plus an in-queue list.
 *
 * Server component. Lists the four published posts as cards in the
 * insights grid, with the eight in-queue titles below as a muted list.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { TryRelayButton } from "../../_marketing/TryRelayButton";

export const metadata: Metadata = {
  title: "Relay — Blog",
  description:
    "Essays, research, field notes, and customer stories on the human layer behind AI-built software.",
};

const PUBLISHED = [
  {
    slug: "the-irreducibly-human-moment",
    tag: "Essay",
    title: "The irreducibly human moment in software",
    meta: "May 2026 · 11 min read",
  },
  {
    slug: "when-does-an-ai-build-want-a-person",
    tag: "Research",
    title:
      "When does an AI build want a person? A study of 4,200 stuck moments.",
    meta: "April 2026 · 17 min read",
  },
  {
    slug: "anatomy-of-the-handoff",
    tag: "Field notes",
    title:
      "Anatomy of the handoff: what we learned shipping the first 1,000 sessions.",
    meta: "April 2026 · 9 min read",
  },
  {
    slug: "two-person-marketing-team",
    tag: "Customer story",
    title:
      "A two-person marketing team. Twenty internal tools. One engineer on call.",
    meta: "April 2026 · 6 min read",
  },
];

const IN_QUEUE = [
  {
    title: "Software’s coal moment",
    note: "why cheaper code means more engineers, not fewer (Founders, Essay)",
  },
  {
    title: "A craftsperson’s code",
    note: "the principles every Relay engineer signs (Standards, Policy)",
  },
  {
    title: "The shape of an enterprise that builds",
    note: "what 2026 looks like inside a Fortune 500 (Founders, Essay)",
  },
  {
    title: "HIPAA and the press",
    note: "how we trained the bench on PHI (Engineering, Field notes)",
  },
  {
    title: "What we look for in a Relay engineer",
    note: "the bar, in writing (Hiring, Field notes)",
  },
  {
    title: "The economics of follow-the-sun engineering",
    note: "why a press at 3am London costs the same as a press at 11am (Research)",
  },
  {
    title: "Why we don’t do tiers",
    note: "and how we keep quality flat (Engineering, Field notes)",
  },
  {
    title: "One year in",
    note: "what changed (Founders, anniversary essay)",
  },
];

export default function BlogIndexPage() {
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap">
          <span className="r-num">— Resources · Blog</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            How we&rsquo;re thinking about <em>this moment</em>
            <br />
            in software.
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            One Essay, one Research, one Field note, one Customer story.
            Drafted in final voice; ready to copy-edit and ship. Plus eight
            more in queue.
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          <div className="r-insights-grid">
            {PUBLISHED.map((p) => (
              <Link
                key={p.slug}
                href={`/resources/blog/${p.slug}`}
                className="r-insight"
              >
                <span className="r-insight-tag">{p.tag}</span>
                <h3 className="r-insight-title">{p.title}</h3>
                <span className="r-insight-meta">{p.meta}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <div className="r-hero-eyebrow">
            <span className="r-num">— In queue</span>
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
              Eight more drafted, awaiting publication
            </span>
          </div>
          <h2 className="r-h-1" style={{ marginTop: 16, maxWidth: "22ch" }}>
            <em>Eight more</em> in queue.
          </h2>
          <ol
            style={{
              listStyle: "decimal",
              paddingLeft: 24,
              marginTop: 32,
              fontFamily: "var(--font-display)",
              fontSize: 18,
              lineHeight: 1.7,
              maxWidth: "62ch",
              color: "var(--ink-soft)",
            }}
          >
            {IN_QUEUE.map((q) => (
              <li key={q.title} style={{ marginBottom: 8 }}>
                <em>{q.title}</em>
                <span style={{ color: "var(--ink-mute)" }}> — {q.note}</span>
              </li>
            ))}
          </ol>
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
            Click the green dot. A real engineer joins in seconds.
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
