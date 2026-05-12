/*
 * Shared landing-page chrome for /for/<tool>.
 *
 * One template, nine pages. All the variable copy lives in lib/tools.ts; this
 * component renders the chrome (hero, moments, pricing CTA, FAQ, breadcrumbs,
 * JSON-LD). Keeping the markup here means brand changes propagate to all
 * nine pages from a single source.
 */

import Link from "next/link";
import { Shell } from "./Shell";
import { TryRelayButton } from "./TryRelayButton";
import { Breadcrumb } from "./Breadcrumb";
import { JsonLd } from "./JsonLd";
import {
  faqSchema,
  webPageSchema,
  type JsonLdObject,
} from "../../lib/seo/schema";
import type { Tool } from "../../lib/tools";
import { findPost } from "../resources/_data/posts";

// Curated cross-links from every tool page back into the resource library.
// Same set of three for all tool pages, the value to SEO is the link
// itself (passing PageRank, building topical authority across resources)
// not per-tool curation.
const TOOL_RELATED_POSTS: {
  category: "articles" | "research";
  slug: string;
}[] = [
  { category: "articles", slug: "anatomy-of-the-handoff" },
  { category: "research", slug: "when-does-an-ai-build-want-a-person" },
  { category: "articles", slug: "the-irreducibly-human-moment" },
];

const SITE_URL = "https://www.relay.green";

export function ToolLandingPage({ tool }: { tool: Tool }) {
  const url = `${SITE_URL}/for/${tool.slug}`;
  const schemas: JsonLdObject[] = [
    webPageSchema({
      url,
      name: `Relay for ${tool.name}`,
      description: tool.metaDescription,
    }),
    faqSchema(tool.faq.map((f) => ({ question: f.q, answer: f.a }))),
  ];

  return (
    <Shell>
      <JsonLd data={schemas} />

      <section className="r-section r-section-hero">
        <div className="r-wrap">
          <Breadcrumb
            items={[
              { name: "Home", href: "/" },
              { name: "Tools", href: "/product" },
              { name: tool.name, href: `/for/${tool.slug}` },
            ]}
          />
          <div className="r-eyebrow">
            <span>
              For {tool.vendor}&apos;s {tool.name}
            </span>
            <span className="r-mark-dot" aria-hidden="true"></span>
          </div>
          <h1 className="r-h-display" style={{ maxWidth: "18ch" }}>
            Stuck in {tool.name}? <em>Press the dot.</em>
          </h1>
          <p className="r-lede" style={{ marginTop: 28, maxWidth: "60ch" }}>
            {tool.oneLiner}
          </p>
          <div className="r-hero-cta" style={{ marginTop: 32 }}>
            <TryRelayButton />
            <Link href="/pricing" className="r-btn r-btn-ghost">
              See pricing <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          <h2 className="r-h-1" style={{ marginBottom: 32 }}>
            When {tool.name} <em>needs a person.</em>
          </h2>
          <div
            style={{
              display: "grid",
              gap: 24,
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            {tool.moments.map((m, i) => (
              <div
                key={m.title}
                style={{
                  border: "1px solid var(--rule)",
                  borderRadius: 8,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--ink-soft)",
                    marginBottom: 8,
                  }}
                >
                  0{i + 1}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: 22,
                    marginBottom: 12,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {m.title}
                </h3>
                <p style={{ color: "var(--ink-soft)", lineHeight: 1.6 }}>
                  {m.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Common questions
          </h2>
          <dl style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {tool.faq.map((item) => (
              <div key={item.q}>
                <dt
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: 20,
                    marginBottom: 6,
                  }}
                >
                  {item.q}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    color: "var(--ink-soft)",
                    lineHeight: 1.6,
                  }}
                >
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap-narrow">
          <h2 className="r-h-1" style={{ marginBottom: 24 }}>
            Related reading
          </h2>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              borderTop: "1px solid var(--rule)",
            }}
          >
            {TOOL_RELATED_POSTS.map((entry) => {
              const post = findPost(entry.category, entry.slug);
              if (!post) return null;
              const href = `/resources/${post.category}/${post.slug}`;
              return (
                <li
                  key={href}
                  style={{
                    borderBottom: "1px solid var(--rule)",
                    padding: "20px 0",
                  }}
                >
                  <Link
                    href={href}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--ink-soft)",
                      }}
                    >
                      {post.tag} · {post.readTime}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 500,
                        fontSize: 22,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {post.title}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        color: "var(--ink-soft)",
                        lineHeight: 1.55,
                      }}
                    >
                      {post.lede}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap" style={{ textAlign: "center" }}>
          <h2 className="r-h-1" style={{ marginBottom: 16 }}>
            Press the dot.
          </h2>
          <p
            className="r-lede"
            style={{ maxWidth: "44ch", margin: "0 auto 28px" }}
          >
            A senior Relay engineer joins your {tool.name} session in seconds.
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
            <Link href="/product" className="r-btn r-btn-ghost">
              See how it works <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
