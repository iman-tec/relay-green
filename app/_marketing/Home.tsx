/*
 * Marketing site composition (server component).
 *
 * Mirrors the design's home page: nav → Spline hero → tracks marquee →
 * four-moments grid → three-legs grid → stats → pull quote → tracks → CTA →
 * footer. The Spline hero is the only client-side island.
 */

import Link from "next/link";
import { Shell } from "./Shell";
import { SplineHero } from "./SplineHero";
import { TryRelayButton } from "./TryRelayButton";
import { ExplainerVideo } from "./ExplainerVideo";

const TRACKS = [
  {
    id: "claude",
    name: "Claude",
    mark: "C",
    desc: "Anthropic. The reasoning track. Architectures, refactors, the gnarly questions.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    mark: "G",
    desc: "OpenAI. The most-built-on track. Plugins, function calls, pipelines.",
  },
  {
    id: "gemini",
    name: "Gemini",
    mark: "G",
    desc: "Google. Multimodal. Long-context. Workspace-native builds.",
  },
  {
    id: "copilot",
    name: "Copilot",
    mark: "M",
    desc: "Microsoft. Inside the IDE. Inside the org. Enterprise-shaped.",
  },
  {
    id: "cursor",
    name: "Cursor",
    mark: "C",
    desc: "AI-native editor. The track for builders who already speak code.",
  },
  {
    id: "lovable",
    name: "Lovable",
    mark: "L",
    desc: "Prompt-to-app. The marketing manager’s front door. Where most marketing-led builds begin.",
  },
  {
    id: "replit",
    name: "Replit",
    mark: "R",
    desc: "Browser-native dev. Agents. Deploys. The classroom-to-production track.",
  },
  {
    id: "v0",
    name: "v0",
    mark: "v",
    desc: "Vercel. Component generation. The design-to-React handoff track.",
  },
];

// A broad, deliberately interleaved sample of the production stack the
// bench has shipped to. Mixed order (payments / db / hosting / comms /
// analytics / etc.) so the scrolling marquee shows breadth rather than
// reading like a category list.
const INTEGRATIONS = [
  "Stripe",
  "Neon",
  "Supabase",
  "Postgres",
  "MongoDB",
  "Redis",
  "PlanetScale",
  "DynamoDB",
  "MySQL",
  "BigQuery",
  "Snowflake",
  "Firestore",
  "FaunaDB",
  "Vercel",
  "Netlify",
  "Cloudflare",
  "AWS",
  "GCP",
  "Azure",
  "Render",
  "Fly.io",
  "Railway",
  "Heroku",
  "DigitalOcean",
  "Hetzner",
  "SendGrid",
  "Postmark",
  "Resend",
  "Mailgun",
  "Loops",
  "Brevo",
  "Twilio",
  "Vonage",
  "MessageBird",
  "Auth0",
  "Clerk",
  "WorkOS",
  "Okta",
  "Stytch",
  "Firebase Auth",
  "Cognito",
  "Plaid",
  "Persona",
  "Stripe Identity",
  "Onfido",
  "Veriff",
  "Paddle",
  "Lemon Squeezy",
  "Razorpay",
  "Square",
  "PayPal",
  "Adyen",
  "Mercury",
  "Brex",
  "Segment",
  "PostHog",
  "Mixpanel",
  "Amplitude",
  "Plausible",
  "Heap",
  "FullStory",
  "LogRocket",
  "Hotjar",
  "Statsig",
  "Datadog",
  "Sentry",
  "OpenTelemetry",
  "New Relic",
  "Honeycomb",
  "Grafana",
  "Prometheus",
  "BetterStack",
  "Logtail",
  "App Store",
  "Play Store",
  "TestFlight",
  "Expo",
  "Algolia",
  "Meilisearch",
  "Typesense",
  "Elasticsearch",
  "S3",
  "R2",
  "Cloudinary",
  "Mux",
  "Bunny",
  "ImageKit",
  "Uploadcare",
  "Vimeo",
  "HubSpot",
  "Salesforce",
  "Customer.io",
  "Klaviyo",
  "Mailchimp",
  "Marketo",
  "ActiveCampaign",
  "Pipedrive",
  "Intercom",
  "Zendesk",
  "Freshworks",
  "Front",
  "Slack",
  "Discord",
  "WhatsApp Business",
  "Microsoft Teams",
  "Zoom",
  "GitHub",
  "GitLab",
  "Bitbucket",
  "Linear",
  "Jira",
  "Notion",
  "Asana",
  "Figma",
  "Sanity",
  "Contentful",
  "Webflow",
  "Storyblok",
  "Prismic",
  "Strapi",
  "Builder.io",
  "WordPress",
  "Shopify",
  "Ghost",
  "Mapbox",
  "Google Maps",
  "HERE",
  "Pinecone",
  "Weaviate",
  "Qdrant",
  "Chroma",
  "OpenAI",
  "Anthropic",
  "Replicate",
  "Mistral",
  "Cohere",
  "Hugging Face",
  "ElevenLabs",
  "Zapier",
  "n8n",
  "Inngest",
  "Temporal",
  "Trigger.dev",
  "Airbyte",
  "Hasura",
  "Apollo",
  "Prisma",
  "Drizzle",
  "tRPC",
  "Akamai",
  "Fastly",
];

const PHASES = [
  {
    num: "Phase 01",
    label: "Build Phase",
    role: "You build. Your AI engineer supports. Concept to MVP.",
    body: "Generation is not architecture. A prototype is not a product. AI speaks in code; customers don’t — “What does CORS mean? What’s a webhook? Why does my deploy fail?” Then comes the plumbing: CRM, ERP, payments, SSO, third-party APIs. Your AI does the writing; a Relay engineer is one press away the moment judgment is needed.",
  },
  {
    num: "Phase 02",
    label: "Launch and Go-Live",
    role: "Relay leads the effort.",
    body: "Deployment is a discipline. Going live means domains, SSL, security, performance, observability — the 90% that’s invisible until it breaks. A Relay engineer takes the wheel through launch, you stay in the loop, the build ships on a calendar promise.",
  },
  {
    num: "Phase 03",
    label: "Maintain and Scale",
    role: "Relay takes accountability. You focus on your business.",
    body: "Continuity is a form of intelligence. APIs change, dependencies break, traffic grows — code that worked stops working. Your Relay engineer remembers why you chose that database, what the trade-offs were, what’s next. Six months on, that memory is the product.",
  },
];

type PhasePlanTier = { name: string; detail: string; price: string };

type PhasePlan = {
  num: string;
  title: string;
  role: string;
  intro: string;
  tiers: PhasePlanTier[];
  footnotes: string[];
  ctaSubject: string;
};

const HOW_WE_RELAY: PhasePlan[] = [
  {
    num: "Phase 01",
    title: "Build Phase",
    role: "You build. We support.",
    intro:
      "On-demand sessions while your AI takes a build from concept to MVP.",
    tiers: [
      { name: "First session", detail: "10 min on us", price: "Free" },
      { name: "Base plan", detail: "100 min of support", price: "€50" },
      { name: "Pro plan", detail: "240 min of support", price: "€100" },
      { name: "Max plan", detail: "500 min of support", price: "€200" },
    ],
    footnotes: [
      "Each session is 10 min",
      "Each plan is valid for 12 months",
    ],
    ctaSubject: "Relay — Build Phase plan inquiry",
  },
  {
    num: "Phase 02",
    title: "Launch and Go-Live",
    role: "You tell us when. We quote on complexity.",
    intro:
      "A Relay engineer takes the wheel through launch — fixed scope, fixed price, calendar promise.",
    tiers: [
      { name: "Simple", detail: "Single integration", price: "€1,500" },
      {
        name: "Medium",
        detail: "Multi-system, basic compliance",
        price: "€3,000",
      },
      {
        name: "Complex",
        detail: "Regulated · multi-region · high-throughput",
        price: "€5,000",
      },
    ],
    footnotes: ["Customized quote available for specific cases"],
    ctaSubject: "Relay — Launch & Go-Live inquiry",
  },
  {
    num: "Phase 03",
    title: "Maintain and Scale",
    role: "We take accountability. You focus on your business.",
    intro:
      "Monthly retainer. Same team that launched you keeps it shipping, secure, and current.",
    tiers: [
      {
        name: "Monthly retainer",
        detail: "Quoted to your needs",
        price: "€1K – €8K / mo",
      },
    ],
    footnotes: ["Customized quote available for specific cases"],
    ctaSubject: "Relay — Maintain & Scale inquiry",
  },
];

const LATEST_THINKING = [
  {
    tag: "Perspective",
    title: "The next software team is already forming.",
    body: "AI has moved software creation closer to the people with the ideas. The enduring advantage will come from pairing that new creative access with human software engineering judgment.",
  },
  {
    tag: "Field note",
    title: "Creation is becoming a conversation.",
    body: "Prompts, prototypes, reviews, and releases are beginning to live in one continuous workflow. Human software engineers belong inside that workflow.",
  },
  {
    tag: "Commitment",
    title: "Useful software still needs care.",
    body: "The goal is not only to create more software. It is to help more software become reliable, understood, maintained, and worth trusting.",
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
          gap: 8,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: 11,
        }}
      >
        {children}
        <span className="r-mark-dot"
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "var(--green)",
            display: "inline-block",
          }}></span>
      </span>
    </div>
  );
}

export function MarketingHome() {
  return (
    <Shell>
      <SplineHero />

      {/* See Relay in action — 1-min video explainer */}
      <section
        style={{
          background: "var(--ink)",
          color: "var(--cream)",
          padding: "96px 0",
        }}
      >
        <div className="r-wrap-narrow">
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
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0,
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontSize: "0.78em",
                }}
              >
                <span>Relay</span>
                <span className="r-mark-dot"
                  style={{
                    width: "0.5em",
                    height: "0.5em",
                    borderRadius: "50%",
                    background: "var(--green)",
                    display: "inline-block",
                    marginLeft: 1,
                  }}></span>
              </span>
              <span>in action</span>
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "rgba(244,242,238,0.6)",
                maxWidth: "48ch",
                margin: "0 auto",
                lineHeight: 1.55,
              }}
            >
              One minute on how Relay connects AI builders with real
              engineers — from press to launch to ongoing care.
            </p>
          </div>

          {/* The actual explainer — 60-second CSS-animated video. */}
          <ExplainerVideo />
        </div>
      </section>

        {/* Why Relay exists — compact 2-col intro + 4+1 tile grid */}
        <section className="r-section">
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
              <span className="r-mark-dot"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: "var(--green)",
                  display: "inline-block",
                  marginLeft: 0,
                  marginRight: 12,
                }}></span>
              <span>exists</span>
            </div>

            {/* Tight 2-col grid: H2 left (smaller), lede right (vert-centered) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.15fr 1fr",
                gap: 56,
                alignItems: "center",
                marginBottom: 56,
              }}
            >
              <h2
                className="r-h-1"
                style={{
                  marginTop: 0,
                  marginBottom: 0,
                  maxWidth: "22ch",
                  fontSize: "clamp(28px, 3.2vw, 44px)",
                  letterSpacing: "-0.015em",
                  lineHeight: 1.1,
                }}
              >
                The boundary between creator and engineer is{" "}
                <em>dissolving.</em> The need for engineering judgment is{" "}
                <em>not.</em>
              </h2>
              <p
                className="r-lede"
                style={{
                  margin: 0,
                  maxWidth: "52ch",
                }}
              >
                AI has democratized the act of writing code. Architecture,
                deployment, security, and maintenance remain acts of
                judgment — context, accountability, experience that cannot
                be generated. Relay bridges what AI starts and what
                production demands.
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
                    {p.role}
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
                  One team across all three phases. From your first press to
                  next week’s bug. Context compounds. Knowledge deepens. That
                  is the relay.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How we relay — three-phase plans with Get-in-touch CTA */}
        <section className="r-section" style={{ background: "var(--paper)" }}>
          <div className="r-wrap">
            <div style={{ marginBottom: 48 }}>
              <Eyebrow>How we relay</Eyebrow>
              <h2
                className="r-h-1"
                style={{ marginTop: 16, maxWidth: "22ch" }}
              >
                Three phases. One team.
                <br />
                <em>Same engineer the whole way.</em>
              </h2>
            </div>

            <div className="r-legs">
              {HOW_WE_RELAY.map((phase) => (
                <div className="r-leg" key={phase.num}>
                  <div className="r-leg-num">{phase.num}</div>
                  <h3 className="r-leg-title">{phase.title}</h3>
                  <div className="r-leg-tag">{phase.role}</div>
                  <p
                    className="r-leg-desc"
                    style={{ marginBottom: 20, flex: "0 0 auto" }}
                  >
                    {phase.intro}
                  </p>

                  <div
                    style={{
                      borderTop: "1px solid var(--rule)",
                      flex: 1,
                    }}
                  >
                    {phase.tiers.map((tier, i) => (
                      <div
                        key={tier.name}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 12,
                          padding: "12px 0",
                          borderBottom:
                            i < phase.tiers.length - 1
                              ? "1px solid var(--rule)"
                              : "none",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              color: "var(--ink)",
                              letterSpacing: "-0.005em",
                            }}
                          >
                            {tier.name}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--ink-soft)",
                              marginTop: 2,
                              lineHeight: 1.4,
                            }}
                          >
                            {tier.detail}
                          </div>
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--green-deep)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {tier.price}
                        </div>
                      </div>
                    ))}
                  </div>

                  {phase.footnotes.length > 0 && (
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "16px 0 24px",
                        fontSize: 11,
                        color: "var(--ink-mute)",
                        lineHeight: 1.5,
                      }}
                    >
                      {phase.footnotes.map((note) => (
                        <li key={note} style={{ marginBottom: 2 }}>
                          * {note}
                        </li>
                      ))}
                    </ul>
                  )}

                  <a
                    href={`mailto:sales@relay.green?subject=${encodeURIComponent(
                      phase.ctaSubject
                    )}`}
                    className="r-btn r-btn-ink"
                    style={{
                      width: "100%",
                      justifyContent: "center",
                      marginTop: "auto",
                    }}
                  >
                    Get in touch <span className="arrow">→</span>
                  </a>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 24,
                fontSize: 13,
                color: "var(--ink-soft)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                className="r-dot r-dot-static"
                style={{ ["--dot-size" as string]: "6px" }}
              ></span>
              <span>
                We respond to every inquiry within 24 hours. The continuity is
                the moat.
              </span>
            </div>
          </div>
        </section>

        {/* What we support — AI tracks pills + integrations marquee */}
        <section className="r-section" style={{ background: "var(--paper)" }}>
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
                  <span>Relay</span>
                  <span className="r-mark-dot"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "var(--green)",
                      display: "inline-block",
                      marginRight: 10,
                    }}></span>
                  <span>supports</span>
                </span>
              </div>
              <h2
                className="r-h-1"
                style={{ marginTop: 16, marginBottom: 16 }}
              >
                Pick your tools. <em>We’re already there.</em>
              </h2>
              <p className="r-body" style={{ fontSize: 16 }}>
                The Relay team supports the AI tools you build with — and the
                production stack you ship into. Eight front doors. A hundred
                and fifty integrations behind them, and counting.
              </p>
            </div>

            {/* AI tools row */}
            <div style={{ marginBottom: 36 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--ink-mute)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 16,
                }}
              >
                <span>AI tools we support</span>
                <span className="r-mark-dot"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--green)",
                    display: "inline-block",
                  }}></span>
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
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 16px 6px 6px",
                      background: "var(--cream)",
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
                        background: "var(--ink)",
                        color: "var(--cream)",
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
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>Production stack we work with</span>
                  <span className="r-mark-dot"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--green)",
                      display: "inline-block",
                    }}></span>
                </span>
                <span
                  style={{
                    padding: "2px 10px",
                    background: "var(--green-tint)",
                    color: "var(--green-deep)",
                    borderRadius: 999,
                    fontSize: 10,
                    letterSpacing: "0.04em",
                  }}
                >
                  150+ integrations
                </span>
              </div>
              <div className="r-marquee">
                <div className="r-marquee-track">
                  <span>{INTEGRATIONS.join(" · ")}</span>
                  <span>{INTEGRATIONS.join(" · ")}</span>
                </div>
              </div>
              <p
                style={{
                  marginTop: 16,
                  fontSize: 13,
                  color: "var(--ink-soft)",
                  maxWidth: "62ch",
                }}
              >
                If it talks to an API, our engineers have shipped with it. The
                list above is a sample, not a limit — name your stack and
                we’ll match you with someone who has launched on it before.
              </p>
            </div>
          </div>
        </section>

        {/* Insights — Latest Thinking content (3 editorial cards) + Read-all */}
        <section className="r-section">
          <div className="r-wrap">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "end",
                marginBottom: 40,
                flexWrap: "wrap",
                gap: 24,
              }}
            >
              <div>
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
                    <span>Relay</span>
                    <span className="r-mark-dot"
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: "var(--green)",
                        display: "inline-block",
                        marginRight: 10,
                      }}></span>
                    <span>— Insights</span>
                  </span>
                </div>
                <h2
                  className="r-h-1"
                  style={{ marginTop: 16, marginBottom: 0 }}
                >
                  Notes on the shift from prototype creation to{" "}
                  <em>durable software.</em>
                </h2>
              </div>
              <Link
                href="/resources/blog"
                className="r-btn r-btn-link"
                style={{ textDecoration: "none" }}
              >
                Read all insights <span className="arrow">→</span>
              </Link>
            </div>
            <div className="r-insights-grid">
              {LATEST_THINKING.map((item) => (
                <div className="r-insight" key={item.tag}>
                  <span className="r-insight-tag">{item.tag}</span>
                  <h3 className="r-insight-title">{item.title}</h3>
                  <p
                    style={{
                      margin: "12px 0 0",
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: "var(--ink-soft)",
                    }}
                  >
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Banner */}
        <section className="r-cta-banner">
          <div className="r-wrap-narrow">
            <h2 className="r-h-1" style={{ marginBottom: 24 }}>
              AI changed <em>who</em> can build.
              <br />
              Relay changes <em>the way</em> they ship.
            </h2>
            <p className="r-lede">
              Click the green dot. A real engineer joins in seconds. Stays
              with you to launch. Stays with you after.
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
              <button
                type="button"
                className="r-btn r-btn-ghost"
                style={{
                  borderColor: "rgba(244,242,238,0.3)",
                  color: "var(--cream)",
                }}
              >
                Talk to sales <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </section>
    </Shell>
  );
}
