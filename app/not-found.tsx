import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "./_marketing/Shell";
import { RelayLogo } from "./_marketing/RelayLogo";

/*
 * App-router not-found page. Renders for any unrecognized route below
 * the marketing surface. Inherits the Shell (Nav + Footer + cookie
 * consent provider) so the visitor still has a way back into the site.
 *
 * Intentionally quiet — the green dot does the brand work, the copy
 * is short, and the two CTAs route to the most-visited destinations
 * (Home and Pricing). No marketing fluff in an error context.
 */
export const metadata: Metadata = {
  title: "Not found",
  description: "We can't find that page. Try the homepage or the pricing page.",
  // 404s shouldn't be indexed. Belt-and-suspenders: Next sets a 404
  // status code which already signals to crawlers, but the noindex
  // tag makes the intent explicit.
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <Shell>
      <section
        style={{
          padding: "clamp(72px, 12vw, 160px) 0",
          background: "#ffffff",
          textAlign: "center",
        }}
      >
        <div
          className="r-wrap-narrow"
          style={{ maxWidth: 640, margin: "0 auto" }}
        >
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
              justifyContent: "center",
            }}
          >
            <RelayLogo size={11} trailingGap={10} />
            <span>404 · not found</span>
          </div>

          <h1
            className="r-h-display"
            style={{
              margin: "0 0 18px",
              fontSize: "clamp(40px, 6vw, 72px)",
              letterSpacing: "-0.032em",
              lineHeight: 1.02,
            }}
          >
            We can&rsquo;t find{" "}
            <em style={{ color: "var(--green)", fontStyle: "italic" }}>
              that page.
            </em>
          </h1>

          <p
            className="r-lede"
            style={{
              margin: "0 auto 32px",
              maxWidth: "48ch",
              fontSize: "clamp(16px, 1.3vw, 19px)",
            }}
          >
            The link may be old or the page may have moved. Two doors back into
            the rest of Relay.
          </p>

          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link href="/" className="r-btn r-btn-ink">
              Go home <span className="arrow">&rarr;</span>
            </Link>
            <Link href="/pricing" className="r-btn r-btn-ghost">
              See pricing <span className="arrow">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
