/*
 * Related-reading rail rendered at the foot of every article-style page.
 *
 * Picks up to three posts to surface beside the one the reader just
 * finished:
 *
 *   1. Same-category posts (same `category` value), most-recent first
 *   2. Falls back to any other post sorted by date
 *
 * Self is always excluded. The card style mirrors the hub grid so a reader
 * who scrolls to the bottom of an essay sees the same visual language they
 * would on `/resources`, the rail acts as an inline mini-hub instead of a
 * dead-end with only the marketing CTA below.
 */

import Link from "next/link";
import { allSorted, byCategory, postUrl, type Post } from "../_data/posts";

type Props = {
  currentPost: Post;
  /**
   * How many cards to surface. Default 3, the rail reads as a single row
   * on desktop and stacks gracefully on mobile.
   */
  limit?: number;
};

export function RelatedReading({ currentPost, limit = 3 }: Props) {
  const sameCategory = byCategory(currentPost.category).filter(
    (p) => p.slug !== currentPost.slug
  );
  const everythingElse = allSorted().filter(
    (p) => p.slug !== currentPost.slug && p.category !== currentPost.category
  );

  // Same-category first; if there aren't enough, top up from the rest.
  const picks = [...sameCategory, ...everythingElse].slice(0, limit);

  if (picks.length === 0) return null;

  return (
    <section
      style={{
        background: "var(--paper)",
        borderTop: "1px solid var(--rule)",
        borderBottom: "1px solid var(--rule)",
        padding: "56px 0",
      }}
    >
      <div className="r-wrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 28,
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(22px, 2.2vw, 28px)",
              letterSpacing: "-0.012em",
              lineHeight: 1.15,
              margin: 0,
              color: "var(--ink)",
            }}
          >
            Keep reading.
          </h3>
          <Link
            href="/resources"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-mute)",
              textDecoration: "none",
              borderBottom: "1px solid currentColor",
            }}
          >
            All resources →
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {picks.map((p) => (
            <Link
              key={`${p.category}/${p.slug}`}
              href={postUrl(p)}
              style={{
                background: "var(--cream)",
                border: "1px solid var(--rule)",
                borderRadius: 12,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                textDecoration: "none",
                color: "inherit",
                transition: "transform 0.2s ease, border-color 0.2s ease",
              }}
              className="r-related-card"
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-mute)",
                  marginBottom: 12,
                }}
              >
                {p.tag}
              </span>
              <h4
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 500,
                  fontSize: 19,
                  lineHeight: 1.25,
                  letterSpacing: "-0.008em",
                  margin: "0 0 14px",
                  color: "var(--ink)",
                  flex: 1,
                }}
              >
                {p.title}
              </h4>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-mute)",
                  letterSpacing: "0.04em",
                }}
              >
                {p.date} · {p.readTime}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
