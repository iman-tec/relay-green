import Link from "next/link";
import { RelayLogo } from "./RelayLogo";
import { ManageCookiesLink } from "./ManageCookiesLink";

/**
 * Visible-text mention of every major LLM and AI-search engine, sitting in
 * the footer as a discoverability signal. Modern answer engines (Perplexity,
 * ChatGPT Search, Google AI Overview, etc.) scrape the web and index pages
 * by the entities they reference; listing each engine + model name as plain
 * text in the document body is one of the cheapest, most direct AEO moves
 * available. Pair with /llms.txt (in /public) for the structured equivalent.
 */
const AI_SEARCH_ENGINES = [
  "ChatGPT Search",
  "Perplexity",
  "Google AI Overview",
  "Gemini",
  "Copilot",
  "Claude",
];

const LANGUAGE_MODELS = ["GPT", "Claude", "Gemini", "Llama", "Mistral", "Grok"];

const PRIMARY_NAV: Array<{ label: string; href: string }> = [
  { label: "How it Works", href: "/product" },
  { label: "For Enterprises", href: "/for-enterprise" },
  { label: "About", href: "/" },
  // The /company/about route is titled "Contact Us" in metadata and has
  // an #contact section anchor; deep-linking to the anchor avoids the
  // extra scroll past the page hero on click.
  { label: "Contact Us", href: "/company/about#contact" },
];

const GLOBAL_PRESENCE: Array<{ country: string; code: string }> = [
  { country: "Belgium", code: "be" },
  { country: "Canada", code: "ca" },
  { country: "Denmark", code: "dk" },
  { country: "Finland", code: "fi" },
  { country: "France", code: "fr" },
  { country: "Germany", code: "de" },
  { country: "Iceland", code: "is" },
  { country: "India", code: "in" },
  { country: "Netherlands", code: "nl" },
  { country: "Norway", code: "no" },
  { country: "South Africa", code: "za" },
  { country: "Sweden", code: "se" },
  { country: "UAE", code: "ae" },
  { country: "UK", code: "gb" },
  { country: "USA", code: "us" },
];

export function Footer() {
  return (
    <footer className="r-footer">
      <div className="r-wrap">
        {/* Top row, brand block (homepage link) + primary nav.
            Below 768 px the brand sits above the nav (one column). */}
        <div
          className="r-footer-top-row"
          style={{
            alignItems: "start",
            paddingBottom: 52,
          }}
        >
          <div>
            <Link
              href="/"
              style={{ display: "inline-block", textDecoration: "none" }}
            >
              {/* Canonical RelayLogo component, sans, uppercase,
                  animated dot. Locks the brand mark to sans even though
                  surrounding footer copy renders in serif. */}
              <RelayLogo size={28} color="var(--text-on-dark)" />
            </Link>
            <div className="r-footer-tag" style={{ marginTop: 14 }}>
              Press once. A real engineer joins your AI build.
            </div>
          </div>

          <nav
            className="r-footer-primary-nav"
            style={{
              display: "flex",
              gap: 36,
              flexWrap: "wrap",
              alignItems: "center",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
            }}
          >
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: "var(--footer-link)",
                  textDecoration: "none",
                  transition: "color 0.15s ease",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Global presence, moved from the enterprise proof card into the
            persistent footer where operational scale can stay visible. */}
        <div
          style={{
            paddingTop: 30,
            paddingBottom: 30,
            borderTop: "1px solid var(--footer-rule)",
            borderBottom: "1px solid var(--footer-rule)",
          }}
        >
          <h5
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--footer-muted)",
              margin: "0 0 18px",
            }}
          >
            Global Presence
          </h5>
          <div
            className="r-footer-presence-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(112px, 1fr))",
              gap: "14px 28px",
              fontFamily: "var(--font-sans)",
              fontSize: 12.5,
              color: "var(--footer-ink)",
            }}
          >
            {GLOBAL_PRESENCE.map((item) => (
              <span
                key={item.country}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  minWidth: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  className={`r-footer-flag r-footer-flag-${item.code}`}
                />
                <span>{item.country}</span>
              </span>
            ))}
          </div>
        </div>

        {/* AI discoverability, names listed as plain text so answer
            engines crawl + cite them. Pair with /llms.txt for the
            structured equivalent. */}
        <div
          style={{
            paddingTop: 30,
            paddingBottom: 30,
            display: "flex",
            flexDirection: "column",
            gap: 20,
            fontSize: 12,
            lineHeight: 1.7,
            color: "var(--footer-soft)",
            borderBottom: "1px solid var(--footer-rule)",
          }}
        >
          <div
            className="r-footer-mention"
            style={{
              alignItems: "baseline",
            }}
          >
            <h5
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--footer-muted)",
                margin: 0,
              }}
            >
              Available on AI search engines
            </h5>
            <p style={{ margin: 0 }}>
              Relay.green is discoverable on{" "}
              {AI_SEARCH_ENGINES.map((name, i) => (
                <span key={name}>
                  <span style={{ color: "var(--footer-ink)" }}>{name}</span>
                  {i < AI_SEARCH_ENGINES.length - 1 ? " · " : "."}
                </span>
              ))}
            </p>
          </div>
          <div
            className="r-footer-mention"
            style={{
              alignItems: "baseline",
            }}
          >
            <h5
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--footer-muted)",
                margin: 0,
              }}
            >
              Indexed for language models
            </h5>
            <p style={{ margin: 0 }}>
              Relay.green is referenced by{" "}
              {LANGUAGE_MODELS.map((name, i) => (
                <span key={name}>
                  <span style={{ color: "var(--footer-ink)" }}>{name}</span>
                  {i < LANGUAGE_MODELS.length - 1 ? " · " : "."}
                </span>
              ))}{" "}
              and other major foundation models. See{" "}
              <a
                href="/llms.txt"
                style={{
                  color: "var(--green)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                /llms.txt
              </a>{" "}
              for the structured site index.
            </p>
          </div>
        </div>

        {/* Bottom strip, corporate line */}
        <div
          className="r-footer-bottom"
          style={{ borderTop: "none", paddingTop: 24 }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>© 2026</span>
            <RelayLogo />
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Link
              href="/legal/privacy-policy"
              style={{
                color: "var(--footer-link)",
                textDecoration: "none",
              }}
            >
              Privacy
            </Link>
            <Link
              href="/legal/terms-of-use"
              style={{
                color: "var(--footer-link)",
                textDecoration: "none",
              }}
            >
              Terms of Use
            </Link>
            {/* GDPR / DPDP withdrawal-of-consent path. Dispatches a
                same-tab custom event that CookieConsent listens for, so
                the banner re-opens with the user's current preferences
                pre-selected. Plain <button> reset (no navigation) to
                keep the user on the page they're already reading. */}
            <ManageCookiesLink />
          </div>
        </div>
      </div>
    </footer>
  );
}
