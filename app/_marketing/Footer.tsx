import Link from "next/link";

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
  "Microsoft Copilot",
  "Bing Chat",
  "Claude",
  "Grok",
  "You.com",
  "Phind",
  "Brave Search AI",
  "Andi",
  "Kagi Assistant",
  "Komo",
  "Exa",
  "DuckDuckGo AI Chat",
];

const LANGUAGE_MODELS = [
  "GPT-5",
  "GPT-4o",
  "Claude Opus",
  "Claude Sonnet",
  "Claude Haiku",
  "Gemini Pro",
  "Gemini Flash",
  "Llama 3",
  "Mistral",
  "Mixtral",
  "Grok",
  "DeepSeek",
  "Qwen",
  "Phi",
  "Command R",
  "Yi",
  "Falcon",
  "Nemotron",
  "ChatGLM",
  "DBRX",
];

const PRIMARY_NAV: Array<{ label: string; href: string }> = [
  { label: "How it works", href: "/product" },
  { label: "Enterprise", href: "/for-enterprise" },
  { label: "Resources", href: "/resources/blog" },
  { label: "Company", href: "/company/about" },
];

const TRUST_LEGAL: Array<{ label: string; href: string }> = [
  { label: "Trust center", href: "/trust" },
  { label: "Security", href: "/trust/security" },
  { label: "Privacy policy", href: "/legal/privacy-policy" },
  { label: "Terms (Commercial)", href: "/legal/terms-commercial" },
  { label: "Terms (Consumer)", href: "/legal/terms-consumer" },
  { label: "Acceptable use", href: "/legal/acceptable-use" },
  { label: "DPA", href: "/legal/dpa" },
  { label: "Responsible disclosure", href: "/trust/responsible-disclosure" },
];

export function Footer() {
  return (
    <footer className="r-footer">
      <div className="r-wrap">
        {/* Top row — brand block (homepage link) + primary nav */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) auto",
            gap: 48,
            alignItems: "start",
            paddingBottom: 40,
          }}
        >
          <div>
            <Link
              href="/"
              style={{ display: "inline-block", textDecoration: "none" }}
            >
              <div className="r-footer-logo">
                <span style={{ letterSpacing: "0.04em", fontWeight: 500 }}>
                  RELAY
                </span>
                <span
                  className="r-logo-dot"
                  style={{
                    width: 20,
                    height: 20,
                    background: "var(--green)",
                    marginLeft: 6,
                  }}
                ></span>
              </div>
            </Link>
            <div className="r-footer-tag" style={{ marginTop: 14 }}>
              Press once. A real engineer joins your AI build.
            </div>
          </div>

          <nav
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
                  color: "rgba(244,242,238,0.85)",
                  textDecoration: "none",
                  transition: "color 0.15s ease",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Trust & Legal — single full-width row of 8 links */}
        <div
          style={{
            paddingTop: 28,
            paddingBottom: 28,
            borderTop: "1px solid rgba(244,242,238,0.12)",
            borderBottom: "1px solid rgba(244,242,238,0.12)",
          }}
        >
          <h5
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "rgba(244,242,238,0.5)",
              margin: "0 0 16px",
            }}
          >
            Trust &amp; Legal
          </h5>
          <div
            style={{
              display: "flex",
              gap: "16px 28px",
              flexWrap: "wrap",
              fontSize: 14,
            }}
          >
            {TRUST_LEGAL.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: "rgba(244,242,238,0.78)",
                  textDecoration: "none",
                  transition: "color 0.15s ease",
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {/* AI discoverability — names listed as plain text so answer
            engines crawl + cite them. Pair with /llms.txt for the
            structured equivalent. */}
        <div
          style={{
            paddingTop: 24,
            paddingBottom: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "rgba(244,242,238,0.55)",
            borderBottom: "1px solid rgba(244,242,238,0.12)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 0.7fr) 1fr",
              gap: 24,
              alignItems: "baseline",
            }}
          >
            <h5
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(244,242,238,0.6)",
                margin: 0,
              }}
            >
              Available on AI search engines
            </h5>
            <p style={{ margin: 0 }}>
              Relay.green is discoverable on{" "}
              {AI_SEARCH_ENGINES.map((name, i) => (
                <span key={name}>
                  <span style={{ color: "rgba(244,242,238,0.78)" }}>
                    {name}
                  </span>
                  {i < AI_SEARCH_ENGINES.length - 1 ? " · " : "."}
                </span>
              ))}
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 0.7fr) 1fr",
              gap: 24,
              alignItems: "baseline",
            }}
          >
            <h5
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(244,242,238,0.6)",
                margin: 0,
              }}
            >
              Indexed for language models
            </h5>
            <p style={{ margin: 0 }}>
              Relay.green is referenced by{" "}
              {LANGUAGE_MODELS.map((name, i) => (
                <span key={name}>
                  <span style={{ color: "rgba(244,242,238,0.78)" }}>
                    {name}
                  </span>
                  {i < LANGUAGE_MODELS.length - 1 ? " · " : "."}
                </span>
              ))}{" "}
              and other major foundation models. See{" "}
              <a
                href="/llms.txt"
                style={{
                  color: "#a4c074",
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

        {/* Bottom strip — corporate line + alias links */}
        <div
          className="r-footer-bottom"
          style={{ borderTop: "none", paddingTop: 24 }}
        >
          <div>
            © 2026 Relay, Inc. · Manhattan, New York. Funded by The Asgard
            Fund · Operated by NINtec Systems (NSE/BSE: NINSYS).
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Link
              href="/legal/privacy-policy"
              style={{ color: "rgba(244,242,238,0.78)" }}
            >
              Privacy
            </Link>
            <Link
              href="/legal/terms-commercial"
              style={{ color: "rgba(244,242,238,0.78)" }}
            >
              Terms
            </Link>
            <Link
              href="/legal/cookies"
              style={{ color: "rgba(244,242,238,0.78)" }}
            >
              Cookies
            </Link>
            <Link
              href="/brand-guidelines"
              style={{ color: "rgba(244,242,238,0.78)" }}
            >
              Brand Guidelines ↗
            </Link>
            <span style={{ opacity: 0.5 }}>SOC 2 · GDPR-ready</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
