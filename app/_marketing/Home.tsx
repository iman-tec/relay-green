/*
 * Marketing site composition (server component).
 *
 * Mirrors the design's home page: nav → Spline hero → tracks marquee →
 * four-moments grid → three-legs grid → stats → pull quote → tracks → CTA →
 * footer. The Spline hero is the only client-side island.
 */

import { Shell } from "./Shell";
import { SplineHero } from "./SplineHero";
import { HowItWorks } from "./HowItWorks";
import { RelayLogo } from "./RelayLogo";
import { EnterpriseCta } from "./EnterpriseCta";
import { PhaseCards, type PhaseCard } from "./PhaseCards";
import { PressTheDot } from "./PressTheDot";
import { VideoCard } from "./VideoCard";

const TRACKS = [
  {
    id: "claude",
    name: "Claude",
    mark: "C",
    color: "#cc785c",
    desc: "Anthropic. The reasoning track. Architectures, refactors, the gnarly questions.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    mark: "G",
    color: "#10a37f",
    desc: "OpenAI. The most-built-on track. Plugins, function calls, pipelines.",
  },
  {
    id: "gemini",
    name: "Gemini",
    mark: "G",
    color: "#5f6368",
    desc: "Google. Multimodal. Long-context. Workspace-native builds.",
  },
  {
    id: "copilot",
    name: "Copilot",
    mark: "M",
    color: "#7c3aed",
    desc: "Microsoft. Inside the IDE. Inside the org. Enterprise-shaped.",
  },
  {
    id: "cursor",
    name: "Cursor",
    mark: "C",
    color: "#6b7280",
    desc: "AI-native editor. The track for builders who already speak code.",
  },
  {
    id: "lovable",
    name: "Lovable",
    mark: "L",
    color: "#ec4899",
    desc: "Prompt-to-app. The marketing manager’s front door. Where most marketing-led builds begin.",
  },
  {
    id: "replit",
    name: "Replit",
    mark: "R",
    color: "#f26207",
    desc: "Browser-native dev. Agents. Deploys. The classroom-to-production track.",
  },
  {
    id: "v0",
    name: "v0",
    mark: "v",
    color: "#000000",
    desc: "Vercel. Component generation. The design-to-React handoff track.",
  },
  {
    id: "bolt",
    name: "Bolt",
    mark: "B",
    color: "#2563eb",
    desc: "StackBlitz. In-browser AI builds. WebContainers. Instant deploys.",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    mark: "W",
    color: "#06b6d4",
    desc: "Codeium. Agentic IDE. Long-running tasks. Multi-file context.",
  },
];

// Full production-stack list (~145 services) used by the homepage marquee.
// Alphabetized so the scrolling rows interleave categories (payments, db,
// hosting, comms, analytics, etc.) and read as breadth rather than as a
// category list.
const INTEGRATIONS = [
  "Adyen",
  "Airbyte",
  "Algolia",
  "Amplitude",
  "Anthropic",
  "Apollo",
  "App Store",
  "Asana",
  "Auth0",
  "AWS",
  "Azure",
  "BetterStack",
  "BigQuery",
  "Bitbucket",
  "Brevo",
  "Brex",
  "Bubble",
  "Builder.io",
  "Bunny",
  "Chroma",
  "Clerk",
  "Cloudflare",
  "Cloudinary",
  "Cognito",
  "Cohere",
  "Contentful",
  "Customer.io",
  "Datadog",
  "DigitalOcean",
  "Discord",
  "Drizzle",
  "DynamoDB",
  "Elasticsearch",
  "ElevenLabs",
  "Expo",
  "Fastly",
  "FaunaDB",
  "Figma",
  "Firebase Auth",
  "Firestore",
  "Fly.io",
  "Freshworks",
  "Front",
  "FullStory",
  "GCP",
  "Ghost",
  "GitHub",
  "GitLab",
  "Google Maps",
  "Grafana",
  "Hasura",
  "Heap",
  "Heroku",
  "Hetzner",
  "Honeycomb",
  "Hotjar",
  "HubSpot",
  "Hugging Face",
  "ImageKit",
  "Inngest",
  "Intercom",
  "Jira",
  "Klaviyo",
  "Lemon Squeezy",
  "Linear",
  "LogRocket",
  "Loops",
  "Mailchimp",
  "Mailgun",
  "Mapbox",
  "Marketo",
  "Meilisearch",
  "Mercury",
  "MessageBird",
  "Microsoft Teams",
  "Mistral",
  "Mixpanel",
  "MongoDB",
  "Mux",
  "MySQL",
  "Neon",
  "Netlify",
  "New Relic",
  "Notion",
  "Okta",
  "Onfido",
  "OpenAI",
  "OpenTelemetry",
  "Paddle",
  "PayPal",
  "Persona",
  "Pinecone",
  "Pipedrive",
  "PlanetScale",
  "Plausible",
  "Play Store",
  "Postgres",
  "PostHog",
  "Postmark",
  "Prisma",
  "Prismic",
  "Prometheus",
  "Qdrant",
  "Railway",
  "Razorpay",
  "Redis",
  "Render",
  "Replicate",
  "Resend",
  "Salesforce",
  "Sanity",
  "S3",
  "Segment",
  "SendGrid",
  "Sentry",
  "Shopify",
  "Slack",
  "Snowflake",
  "Square",
  "Statsig",
  "Storyblok",
  "Strapi",
  "Stripe",
  "Stripe Identity",
  "Stytch",
  "Supabase",
  "Temporal",
  "TestFlight",
  "Trigger.dev",
  "tRPC",
  "Twilio",
  "Typesense",
  "Uploadcare",
  "Veriff",
  "Vercel",
  "Vimeo",
  "Vonage",
  "Weaviate",
  "Webflow",
  "WhatsApp Business",
  "WordPress",
  "WorkOS",
  "Zapier",
  "Zendesk",
  "Zoom",
];

const PHASES = [
  {
    num: "Phase 01",
    label: "Build Phase",
    role: "You build. Your AI engineer supports. Concept to MVP.",
    body: "Generation is not architecture. A prototype is not a product. AI speaks in code; customers don’t, “What does CORS mean? What’s a webhook? Why does my deploy fail?” Then comes the plumbing: CRM, ERP, payments, SSO, third-party APIs. Your AI does the writing; a Relay engineer is one press away the moment judgment is needed.",
  },
  {
    num: "Phase 02",
    label: "Launch and Go-Live",
    role: "Relay leads the effort.",
    body: "Deployment is a discipline. Going live means domains, SSL, security, performance, observability, the 90% that’s invisible until it breaks. A Relay engineer takes the wheel through launch, you stay in the loop, the build ships on a calendar promise.",
  },
  {
    num: "Phase 03",
    label: "Maintain and Scale",
    role: "Relay takes accountability. You focus on your business.",
    body: "Continuity is a form of intelligence. APIs change, dependencies break, traffic grows, code that worked stops working. Your Relay engineer remembers why you chose that database, what the trade-offs were, what’s next. Six months on, that memory is the product.",
  },
];

/*
 * Phase-card metadata. Tier rows + prices now live in app/_marketing/plans.ts
 * so the homepage and /payment share one source of truth. PhaseCards reads
 * the tier data via plansForPhase(phase).
 */
const HOW_WE_RELAY: PhaseCard[] = [
  {
    num: "Phase 01",
    title: "Build Phase",
    role: "You build. We support.",
    intro:
      "On-demand sessions while your AI takes a build from concept to MVP.",
    phase: "phase1",
    footnotes: ["Each session is 10 min", "Each plan is valid for 12 months"],
    contactTopic: "build",
  },
  {
    num: "Phase 02",
    title: "Launch and Go-Live",
    role: "You tell us when. We quote on complexity.",
    intro:
      "A Relay engineer takes the wheel through launch, fixed scope, fixed price, calendar promise.",
    phase: "phase2",
    footnotes: ["Customized quote available for specific cases"],
    contactTopic: "launch",
  },
  {
    num: "Phase 03",
    title: "Maintain and Scale",
    role: "We take accountability. You focus on your business.",
    intro:
      "Monthly retainer. Same team that launched you keeps it shipping, secure, and current.",
    phase: "phase3",
    footnotes: ["Customized quote available for specific cases"],
    contactTopic: "maintain",
  },
];

// FAQ items rendered above the Insights section. Native <details>/<summary>
// gives keyboard + screen-reader behavior for free; the styling rotates a
// CSS "+" into a "×" via transform when the disclosure opens. Default open
// (matches the design comp) so a first-time visitor sees the answers
// without having to click around.
const FAQ: { q: string; a: string }[] = [
  {
    q: "I’m not a developer. Will the engineer judge my AI-generated code?",
    a: "No. The engineers on Relay specifically work with builders using AI tools. They’ve seen every kind of Lovable, Cursor, and Replit project. They start where your code is, not where they wish it was. No rewrites for ego.",
  },
  {
    q: "What AI tools do you support?",
    a: "Lovable, Cursor, Replit, v0, Bolt, Windsurf, Claude, ChatGPT, Gemini, and Copilot are the most common. If you built it with AI and it talks to the internet, we can help. Tell us your stack when you connect.",
  },
  {
    q: "Is my code and data safe?",
    a: "Yes. Sessions are private and ephemeral by default. Engineers sign an NDA before joining your call. We’re GDPR-compliant. For enterprise, we offer dedicated regions and signed BAAs.",
  },
  {
    q: "What if I just need a quick answer, not an hour-long call?",
    a: "Every session is a 10-minute block. Past 10 minutes, you’re billed by the minute for exactly the time you used.",
  },
  {
    q: "Can I cancel my plan?",
    a: "Plans can’t be cancelled once purchased. Every plan is valid for 12 months from the day you activate it, so unused minutes carry across the year.",
  },
  {
    q: "Do you take on net-new builds from scratch?",
    a: "Relay is for builders who already have something: an AI prototype, an MVP, a live product. If you’re starting from zero, build a v0 or Lovable prototype first, then bring us in. If you need us to take net-new builds then visit www.thegaetwaydigital.com, who are our trusted partners and can implement AI engineering projects from scratch.",
  },
];

function Eyebrow({
  num,
  children,
}: {
  num?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="r-hero-eyebrow">
      {num && <span className="r-num">{num}</span>}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          /* gap:0 so the dot sits flush against the wordmark text.
             Children that need spacing AFTER the dot (e.g. "Why Relay
             • exists") set marginRight on the dot itself. */
          gap: 0,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 11,
        }}
      >
        {children}
        {/* All sizing + green + animation come from .r-mark-dot
            defaults: 1em diameter (matches the 11px eyebrow), flush
            right of the wordmark, brand green, pulse via ::after. */}
        <span className="r-mark-dot" aria-hidden="true"></span>
      </span>
    </div>
  );
}

export function MarketingHome() {
  return (
    <Shell>
      <SplineHero />

      <HowItWorks />

      {/* How we relay, three-phase plans with Get-in-touch CTA.
          id="pricing" is the anchor target for the global "Pricing"
          nav link, which deep-links to this section from any page. */}
      <section
        id="pricing"
        className="r-section"
        style={{ background: "#f5f5f7", scrollMarginTop: "80px" }}
      >
        <div className="r-wrap">
          <div style={{ marginBottom: 48 }}>
            <Eyebrow>How we relay</Eyebrow>
            <h2 className="r-h-1" style={{ marginTop: 16, maxWidth: "22ch" }}>
              Three phases. One team.
            </h2>
          </div>

          <PhaseCards phases={HOW_WE_RELAY} />

          <EnterpriseCta />
        </div>
      </section>

      {/* See Relay in action, two explainer films, side-by-side.
          Left: motion-graphic concept (CSS-animated, ExplainerVideo).
          Right: cinematic live-action film (Higgsfield-generated, mp4). */}
      <section
        style={{
          background: "var(--ink)",
          color: "var(--cream)",
          padding: "96px 0",
        }}
      >
        <div
          className="r-wrap-narrow"
          style={{ maxWidth: 1320, padding: "0 24px" }}
        >
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 3.4vw, 44px)",
                letterSpacing: "-0.018em",
                lineHeight: 1.15,
                margin: "0 0 14px",
                color: "var(--cream)",
                fontWeight: 400,
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <span>See</span>
              <RelayLogo size="0.78em" />
              <span>in action</span>
            </h2>
          </div>

          {/* 2-up grid: enterprise pitch (left) and product walkthrough
              (right). Each card is an idle poster with a green corner-play
              button + inset metadata; click swaps in the native <video>. */}
          <div className="r-explainer-2up" style={{ alignItems: "start" }}>
            <VideoCard
              src="/relay-explainer-enterprise-v1.mp4"
              poster="/relay-explainer-v6-poster.svg"
              eyebrow="Enterprise pitch"
              duration="47s"
              description="Why governance, compliance, and scale matter when AI ships to prod."
              testId="hero-video-enterprise"
            />
            <VideoCard
              src="/relay-combine-v2b.mp4"
              poster="/relay-explainer-v6-poster.svg"
              eyebrow="Product walkthrough"
              duration="3 min"
              description="How a build becomes a live launch — paired with a real engineer."
              testId="hero-video-cinematic"
            />
          </div>
        </div>
      </section>

      {/* Why Relay exists, compact 2-col intro + 4+1 tile grid */}
      <section className="r-section" style={{ background: "#f5f5f7" }}>
        <div className="r-wrap">
          {/* Eyebrow on its own row, top-left */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 500,
              color: "var(--ink-soft)",
              marginBottom: 24,
            }}
          >
            <span>Why Relay</span>
            <span
              className="r-mark-dot"
              style={{ marginRight: 12 }}
              aria-hidden="true"
            ></span>
            <span>exists</span>
          </div>

          {/* Tight 2-col grid: H2 left (smaller), lede right (vert-centered).
              Collapses to 1-col below 768 px via .r-grid-2. */}
          <div
            className="r-grid-2"
            style={{
              alignItems: "center",
              marginBottom: 56,
            }}
          >
            <h2
              className="r-h-1"
              style={{
                marginTop: 0,
                marginBottom: 0,
                maxWidth: "30ch",
                fontSize: "clamp(22px, 2.5vw, 34px)",
                letterSpacing: "-0.015em",
                lineHeight: 1.15,
              }}
            >
              The line between creator and engineer is <em>disappearing.</em>
              <br />
              Engineering judgment is <em>not.</em>
            </h2>
            <p
              className="r-lede"
              style={{
                margin: 0,
                maxWidth: "52ch",
                fontSize: "clamp(16px, 1.3vw, 19px)",
              }}
            >
              AI accelerates creation.
              <br />
              <RelayLogo size="1em" color="var(--ink)" /> adds the engineering
              judgment required for production.
            </p>
          </div>

          <div className="r-tiles r-tiles-trio">
            {PHASES.map((p) => (
              <div className="r-tile" key={p.num}>
                <div className="r-tile-num">{p.num}</div>
                <h3 className="r-tile-title">{p.label}</h3>
                <p
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: 16,
                    lineHeight: 1.3,
                    color: "var(--green-deep)",
                    letterSpacing: "-0.005em",
                    margin: "0 0 14px",
                    minHeight: "2.6em",
                  }}
                >
                  <span className="mk-sweep">{p.role}</span>
                </p>
                <p className="r-tile-body">{p.body}</p>
              </div>
            ))}
            <div className="r-tile r-tile-base">
              <div>
                <div className="r-tile-num">Across all three phases</div>
                <h3 className="r-tile-title">
                  Same team.{" "}
                  <em
                    style={{
                      color: "var(--green-bright)",
                      fontStyle: "italic",
                    }}
                  >
                    End to end.
                  </em>
                </h3>
              </div>
              <p className="r-tile-body">
                One team across all three phases. From your first press to next
                week’s bug. Context compounds. Knowledge deepens. That is the
                relay.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What we support, AI tracks pills + integrations marquee */}
      <section className="r-section" style={{ background: "#ffffff" }}>
        <div className="r-wrap">
          <div style={{ marginBottom: 40, maxWidth: "62ch" }}>
            <div className="r-hero-eyebrow">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontSize: 11,
                }}
              >
                <RelayLogo size={11} trailingGap={10} />
                <span>supports</span>
              </span>
            </div>
            <h2 className="r-h-1" style={{ marginTop: 16, marginBottom: 16 }}>
              Pick your tools. <em>We’re already there.</em>
            </h2>
            <p className="r-body" style={{ fontSize: 16 }}>
              The Relay team supports the AI tools you build with, and the
              production stack you ship into. Eight front doors. A hundred and
              fifty integrations behind them, and counting.
            </p>
          </div>

          {/* AI tools row */}
          <div style={{ marginBottom: 36 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-mute)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              AI tools we support
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {TRACKS.map((t) => (
                <span
                  key={t.id}
                  className="r-track-chip"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 16px 6px 6px",
                    background: "#ffffff",
                    border: "1px solid var(--rule)",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--ink)",
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      background: t.color,
                      color: "#ffffff",
                      borderRadius: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {t.mark}
                  </span>
                  {t.name}
                </span>
              ))}
            </div>
          </div>

          {/* Production stack marquee */}
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-mute)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>Production stack we work with</span>
            </div>
            {(() => {
              // Split the full production-stack list into 3 visual rows
              // (~48 / 48 / 48). All rows scroll the same direction; the
              // outer .r-marquee container provides one unified border so
              // the three lines read as a single ticker block.
              const rowSize = Math.ceil(INTEGRATIONS.length / 3);
              const rows = [
                INTEGRATIONS.slice(0, rowSize),
                INTEGRATIONS.slice(rowSize, rowSize * 2),
                INTEGRATIONS.slice(rowSize * 2),
              ];
              return (
                <div className="r-marquee r-marquee-multi">
                  {rows.map((row, i) => (
                    <div className="r-marquee-track" key={i}>
                      <span>{row.join(" · ")}</span>
                      <span>{row.join(" · ")}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p
              style={{
                marginTop: 16,
                fontSize: 13,
                color: "var(--ink-soft)",
                maxWidth: "none",
              }}
            >
              If it talks to an API, our engineers have shipped with it. The
              list above is a sample, not a limit, name your stack and we’ll
              match you with someone who has launched on it before.
            </p>
          </div>
        </div>
      </section>

      {/* Press the dot — closing CTA above the FAQ. Cream plate, big
          green sphere, italic-serif headline, filled green pill, and a
          mono spec strip with trust signals. Component is client-only
          because the sphere and the pill both call useTryRelay().open. */}
      <PressTheDot />

      {/* FAQ — editorial 2-col layout with intro on the left and a white
          card of expandable items on the right. <details> elements give
          native keyboard + screen-reader support; the "+" indicator
          rotates 45° to a "×" on open via CSS. All items default open
          so first-time visitors see answers without clicking. */}
      <section
        className="r-section r-faq"
        aria-label="Frequently asked questions"
      >
        <div className="r-wrap">
          <div className="r-faq-grid">
            <div className="r-faq-intro">
              <div className="r-faq-eyebrow">FAQ</div>
              <h2 className="r-h-1 r-faq-h">
                Questions builders ask before pressing <em>the dot.</em>
              </h2>
              <p className="r-faq-lede">
                Still wondering something? Send us a note. A real human answers
                within the hour.
              </p>
              <a href="mailto:support@relay.green" className="r-faq-email">
                <span
                  className="r-dot r-dot-static"
                  style={{ ["--dot-size" as string]: "8px" }}
                  aria-hidden="true"
                />
                <span>
                  Email{" "}
                  <span className="r-faq-email-addr">support@relay.green</span>
                </span>
              </a>
            </div>
            <div className="r-faq-list">
              {FAQ.map((item) => (
                <details key={item.q} className="r-faq-item">
                  <summary>
                    <span className="r-faq-q">{item.q}</span>
                    <span className="r-faq-icon" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="r-faq-a">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Shell>
  );
}

