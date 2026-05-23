/*
 * /resources, top-level hub.
 *
 * Server component. Pulls every post from the registry, pins the featured
 * piece at the top, then lays out one block per category showing the three
 * most recent pieces with a "see all" link into each sub-hub. Closes with
 * the standard Try-Relay CTA banner.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "../_marketing/Shell";
import { CtaBanner } from "../_marketing/CtaBanner";
import { HubGrid } from "./_components/HubGrid";
import { RichTitle } from "./_components/RichTitle";
import {
  CATEGORY_LABEL,
  CATEGORY_LEDE,
  byCategory,
  featured,
  postUrl,
  type Category,
} from "./_data/posts";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Articles, research, white papers, guides, and customer stories on the human layer behind AI-built software.",
  alternates: { canonical: "/resources" },
};

const ORDER: Category[] = [
  "articles",
  "research",
  "white-papers",
  "guides",
  "customer-stories",
];

/* Inline helper — green-dot + mono-caps section eyebrow, matching
   the spec-sheet pattern used on /for-enterprise and /product. Kept
   as a component so each category section reads cleanly. */
function SectionEyebrow({ label }: { label: string }) {
  return (
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
        marginBottom: 20,
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
      />
      {label}
    </div>
  );
}

export default function ResourcesHubPage() {
  const pinned = featured();

  return (
    <Shell>
      {/* Hero — same .r-page-header green plate as other sub-pages,
          augmented with the brand spec-sheet eyebrow vocabulary. */}
      <section className="r-page-header">
        <div className="r-wrap">
          <SectionEyebrow label="Resources" />
          <h1 className="r-h-display" style={{ marginTop: 0 }}>
            How we&rsquo;re thinking about <em>this moment</em>
            <br />
            in software.
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            Articles, research, white papers, guides, and customer stories.
            Long-form, written by the people doing the work, on what changes
            when most of your code is written by builders who aren&rsquo;t
            engineers.
          </p>
        </div>
      </section>

      {/* Featured card — cream surface, hairline border, 12px radius
          matching the rest of the brand-card vocabulary. Internal
          metadata in mono caps; title + lede in editorial serif. */}
      {pinned ? (
        <section style={{ padding: "56px 0 0", background: "var(--paper)" }}>
          <div className="r-wrap">
            <Link
              href={postUrl(pinned)}
              style={{
                display: "block",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div
                className="r-grid-collapse-md"
                style={{
                  padding: "32px 36px",
                  background: "var(--cream)",
                  border: "1px solid var(--rule)",
                  borderRadius: 12,
                  display: "grid",
                  gridTemplateColumns: "minmax(180px, 0.5fr) 1fr",
                  gap: 36,
                  alignItems: "center",
                  transition: "border-color 180ms ease, transform 180ms ease",
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
                      color: "var(--green-deep)",
                      marginBottom: 12,
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
                    />
                    Featured · {CATEGORY_LABEL[pinned.category]}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--ink-mute)",
                      lineHeight: 1.6,
                    }}
                  >
                    {pinned.tag} · {pinned.date} · {pinned.readTime}
                  </div>
                </div>
                <div>
                  <RichTitle
                    as="h2"
                    className="r-h-1"
                    style={{
                      margin: "0 0 12px",
                      maxWidth: "26ch",
                      fontSize: "clamp(24px, 2.4vw, 34px)",
                      letterSpacing: "-0.018em",
                      lineHeight: 1.1,
                    }}
                    value={pinned.titleHtml ?? pinned.title}
                  />
                  <p
                    className="r-lede"
                    style={{ margin: 0, maxWidth: "56ch", fontSize: 16 }}
                  >
                    {pinned.lede}
                  </p>
                  <span
                    style={{
                      marginTop: 16,
                      display: "inline-block",
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--green-deep)",
                      borderBottom: "1px solid currentColor",
                      paddingBottom: 2,
                    }}
                  >
                    Read the piece →
                  </span>
                </div>
              </div>
            </Link>
          </div>
        </section>
      ) : null}

      {/* Category sections — alternating paper / cream backgrounds so
          the five blocks have visual rhythm instead of a single long
          column. Each carries the brand spec-sheet eyebrow + tighter
          section header before the HubGrid of the three most recent
          posts in that category. */}
      {ORDER.map((cat, i) => {
        const posts = byCategory(cat);
        if (posts.length === 0) return null;
        const recent = posts.slice(0, 3);
        const bg = i % 2 === 0 ? "var(--paper)" : "var(--cream)";
        return (
          <section
            key={cat}
            style={{
              padding: "56px 0",
              background: bg,
            }}
          >
            <div className="r-wrap">
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 16,
                  marginBottom: 32,
                }}
              >
                <div style={{ maxWidth: "52ch" }}>
                  <SectionEyebrow label={CATEGORY_LABEL[cat]} />
                  <p
                    className="r-lede"
                    style={{
                      margin: 0,
                      fontSize: 17,
                    }}
                  >
                    {CATEGORY_LEDE[cat]}
                  </p>
                </div>
                <Link
                  href={`/resources/${cat}`}
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--green-deep)",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  See all {CATEGORY_LABEL[cat].toLowerCase()} →
                </Link>
              </div>
              <HubGrid posts={recent} showTag={false} />
            </div>
          </section>
        );
      })}

      {/* Shared closing banner — single source of truth across Home /
          product / pricing / resources. */}
      <CtaBanner />
    </Shell>
  );
}
