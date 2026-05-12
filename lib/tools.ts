/*
 * Tool-specific landing-page copy. One row per AI track Relay supports.
 * Each /for/<slug> page renders <ToolLandingPage tool={TOOLS[slug]} />.
 *
 * Keep the prose tight: the page exists to capture tool-specific search
 * intent (e.g. "Cursor not working", "Lovable can't deploy") and route
 * the visitor to a press. The real product copy lives on /product.
 */

export type Tool = {
  slug: string;
  name: string;
  vendor: string;
  oneLiner: string;
  // Search-friendly description used in <meta description> and OG.
  metaDescription: string;
  // Three or four moments where this tool typically wants a person.
  moments: { title: string; body: string }[];
  // Three or four short FAQs; rendered visibly and as FAQPage JSON-LD.
  faq: { q: string; a: string }[];
};

export const TOOLS: Record<string, Tool> = {
  cursor: {
    slug: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    oneLiner:
      "Cursor's AI-native editor moves fast — and so do the moments it asks for help.",
    metaDescription:
      "Stuck in Cursor? A software engineer joins your editor session in seconds. Debug agent loops, untangle refactors, ship the build that wouldn't.",
    moments: [
      {
        title: "When the agent loop won't terminate",
        body: "Cursor's agent mode is excellent until it isn't. When it's burning context on the wrong file or chasing a non-existent type, a Relay engineer joins your screen, prunes the loop, and resets it on the right anchor.",
      },
      {
        title: "When the refactor crosses a boundary the AI can't see",
        body: "Renames across packages, migrations across React versions, framework swaps — Cursor handles a lot of it, but the spots where it breaks are the spots a person needs to be in the room.",
      },
      {
        title: "When you're ready to ship",
        body: "From local-running to production-deployed is its own job. Tests, infra, secrets, observability, the deploy itself. A Relay engineer takes the build the rest of the way.",
      },
    ],
    faq: [
      {
        q: "Do I have to leave Cursor to use Relay?",
        a: "No. Press the dot from anywhere — including a Cursor session — and the engineer joins the screen share or chat without leaving your editor.",
      },
      {
        q: "Will the engineer have my Cursor context?",
        a: "Whatever you've put into the screen share, yes. We don't ingest your Cursor history, embeddings, or workspace state — you bring what you want them to see.",
      },
      {
        q: "Does Relay support Cursor's agent mode?",
        a: "Yes. The most common flavor of press from a Cursor builder is exactly that: an agent loop that needs a senior eye for ten minutes.",
      },
    ],
  },
  lovable: {
    slug: "lovable",
    name: "Lovable",
    vendor: "Lovable.dev",
    oneLiner:
      "Lovable turns prompts into apps. Relay turns the apps into things you can actually run.",
    metaDescription:
      "Lovable shipping issues? Deploy stuck, integration failing, custom domain not resolving? A Relay engineer joins in seconds and ships your build.",
    moments: [
      {
        title: "When the deploy doesn't go",
        body: "The most common Lovable press: a build that runs in preview but won't ship. Environment variables, Vercel/Netlify config, custom domain DNS — a Relay engineer untangles it from the screen share.",
      },
      {
        title: "When you need a real backend",
        body: "Lovable handles a Supabase or Firebase wire-up beautifully — until the schema gets non-trivial. RLS policies, migrations, or moving off Supabase to Postgres on Neon is the moment to call a person.",
      },
      {
        title: "When marketing wants a feature engineering didn't think about",
        body: "Webhooks, Stripe, an analytics hookup, a Slack notification: most marketing-led builds need a five-minute integration that Lovable doesn't auto-generate. That's a press.",
      },
    ],
    faq: [
      {
        q: "Can a Relay engineer take over my Lovable project?",
        a: "We don't take ownership of the project — your account stays yours. The engineer joins your screen, suggests changes you can apply in Lovable directly, and helps you ship.",
      },
      {
        q: "What if I need to migrate off Lovable?",
        a: "Common request. The engineer can mirror the project to a Next.js or Remix codebase and walk through the deploy on Vercel — typically a 30–90 minute session.",
      },
      {
        q: "Do you support custom-domain setup?",
        a: "Yes. DNS changes, Cloudflare proxy, www → apex redirect — the engineer joins, walks through it, and verifies it's resolving.",
      },
    ],
  },
  replit: {
    slug: "replit",
    name: "Replit",
    vendor: "Replit",
    oneLiner:
      "Replit gets you to running fast. Relay gets you to production-ready when the prototype starts being used.",
    metaDescription:
      "Replit deploy failing or app at scale issues? A software engineer joins your Repl in seconds. Database, auth, infra, the press for production.",
    moments: [
      {
        title: "When the agent's stuck on the same error",
        body: "Replit's agent is best-in-class for a starting point. When it's circling a single error for the fifth iteration, a Relay engineer joins and resets the loop.",
      },
      {
        title: "When you need to deploy outside Replit",
        body: "Replit deployments are great for prototypes; for production traffic with a custom domain, observability, and a real database, the engineer can move you to Vercel + Neon (or wherever) without losing the work.",
      },
      {
        title: "When auth needs to be real",
        body: "Replit's quick-start auth is a good starting point. When you need SSO, RBAC, or a session model that scales, the press surfaces a person who's done it.",
      },
    ],
    faq: [
      {
        q: "Can the engineer work directly in my Repl?",
        a: "Yes via screen share, or you can grant temporary read-write access to the Repl. Either way, the change history stays under your account.",
      },
      {
        q: "What if I want to leave Replit?",
        a: "Common move at the production cutover. The engineer can mirror the Repl to a Git repo, set up CI on GitHub Actions, and deploy to Vercel or Render.",
      },
      {
        q: "Do you support Replit's database (Replit DB)?",
        a: "Yes for prototyping. For production, the engineer typically migrates to Postgres (Neon, Supabase, or self-hosted) — the press covers the migration.",
      },
    ],
  },
  v0: {
    slug: "v0",
    name: "v0",
    vendor: "Vercel",
    oneLiner:
      "v0 generates the components. Relay wires them into a shipping app.",
    metaDescription:
      "v0 component issues? Need to wire generated UI into a real app? A Relay engineer joins in seconds — design system, routing, deploy, all of it.",
    moments: [
      {
        title: "When the generated component doesn't fit your design system",
        body: "v0 is excellent at one-shot components. When you need 30 of them to share tokens, dark-mode behavior, and a-11y posture, a Relay engineer reconciles them with your codebase.",
      },
      {
        title: "When you need state, routing, or a backend",
        body: "v0's output is the front of the front-end. Server actions, Auth.js, a real database — that's where the press lands. A Relay engineer wires the generated components into a real Next.js app.",
      },
      {
        title: "When you're ready to deploy",
        body: "v0 scaffolds; Vercel deploys; the press is for everything in between — env vars, edge config, ISR, the dozen things that go wrong on first deploy.",
      },
    ],
    faq: [
      {
        q: "Does Relay work with v0's component-generation flow?",
        a: "Yes. The most common pattern is: you generate a screen in v0, paste it into your repo, and press for an engineer to integrate it with the rest of the app.",
      },
      {
        q: "Can the engineer help me set up a v0-aligned design system?",
        a: "Yes. shadcn/ui + Tailwind tokens + the v0 design conventions are the most common starting point — a Relay engineer can stand it up and harden it.",
      },
      {
        q: "What about Next.js App Router versus Pages Router?",
        a: "Both supported. The engineer will recommend App Router for any new project; for existing Pages Router code, the press covers gradual migration where it makes sense.",
      },
    ],
  },
  bolt: {
    slug: "bolt",
    name: "Bolt",
    vendor: "StackBlitz",
    oneLiner:
      "Bolt is one of the fastest prompt-to-prototype paths. Relay turns the prototype into a thing you can ship.",
    metaDescription:
      "Bolt build stuck or not deploying? A software engineer joins your StackBlitz session in seconds. Debug, deploy, harden the build — same engineer, same session.",
    moments: [
      {
        title: "When Bolt's preview works but the deploy doesn't",
        body: "Bolt's preview environment forgives a lot of config sins. Production won't. The engineer joins, sets up env vars, fixes the runtime, gets the deploy out the door.",
      },
      {
        title: "When you need a backend Bolt didn't generate",
        body: "Bolt scaffolds a frontend cleanly; the API surface is often missing. A Relay engineer wires it up — Postgres, auth, jobs, all of it.",
      },
      {
        title: "When the build needs to leave StackBlitz",
        body: "For real users on a real domain, you'll want to host the app yourself. The engineer mirrors the project to a Git repo and deploys it on Vercel or Cloudflare.",
      },
    ],
    faq: [
      {
        q: "Can I keep working in StackBlitz with the engineer?",
        a: "Yes. The engineer joins your screen and can suggest changes inline; the StackBlitz project stays under your account.",
      },
      {
        q: "What if I want to migrate off Bolt?",
        a: "Common move when the prototype starts being used. The engineer mirrors the project to a fresh Next.js or Remix repo and sets up the deploy.",
      },
      {
        q: "Do you support Bolt's WebContainers runtime?",
        a: "Yes for live debugging. For production, the engineer moves the runtime to a host that can serve real traffic.",
      },
    ],
  },
  claude: {
    slug: "claude",
    name: "Claude",
    vendor: "Anthropic",
    oneLiner:
      "Claude is excellent at the gnarly parts. The press is for when 'excellent' isn't quite enough.",
    metaDescription:
      "Stuck on a Claude code generation? Architecture decision, refactor, deploy — a software engineer joins your session in seconds. Same engineer across pressings.",
    moments: [
      {
        title:
          "When the architecture decision is too consequential to leave to a chat",
        body: "Claude has good intuition; for choices that lock in cost and complexity for the next 18 months — multi-tenant data model, async-job runtime, auth strategy — the press is for a software engineer who's lived with the tradeoffs.",
      },
      {
        title: "When the refactor exceeds Claude's effective context",
        body: "Even a million-token window has limits when the refactor is across 200 files. A Relay engineer breaks it into reviewable pieces, runs each through Claude, and verifies in between.",
      },
      {
        title: "When you need a person on the deploy",
        body: "Claude can write the IaC; deploys still go wrong. The press covers the run.",
      },
    ],
    faq: [
      {
        q: "Does Relay use Claude internally?",
        a: "Our co-pilot for engineers uses Claude Haiku for risk-scoring and session summarization. Customer code is never used to train the model.",
      },
      {
        q: "Can the engineer pair with me in Claude.ai?",
        a: "Yes via screen share. The engineer reviews the conversation, suggests reframes, and helps you turn the output into shipped work.",
      },
      {
        q: "What about Claude Code (the CLI tool)?",
        a: "Fully supported. A common press: hand off a Claude Code session to an engineer mid-build for the steps that need a human in the loop.",
      },
    ],
  },
  chatgpt: {
    slug: "chatgpt",
    name: "ChatGPT",
    vendor: "OpenAI",
    oneLiner:
      "The most-built-on track. The press is for the moments after 'it works'.",
    metaDescription:
      "ChatGPT code generation stuck? Production-grade build needs a person? A Relay engineer joins in seconds — same engineer across sessions.",
    moments: [
      {
        title: "When the OpenAI tool-use chain breaks",
        body: "Tool calls that worked in dev fail in prod. Function-call schemas drift. The press surfaces an engineer who's traced these before.",
      },
      {
        title: "When the prompt's right but the latency isn't",
        body: "Streaming, structured output, model selection across the OpenAI lineup — a Relay engineer profiles the call path and trims the round-trip.",
      },
      {
        title: "When the build needs to ship",
        body: "From notebook to production: env vars, secrets, observability, the deploy. The engineer takes the press through the cutover.",
      },
    ],
    faq: [
      {
        q: "Do you support GPT-5 / GPT-4o?",
        a: "Yes — every model in the OpenAI lineup, including the realtime API and the Assistants API.",
      },
      {
        q: "What about ChatGPT plugins / GPTs?",
        a: "Yes. Building a custom GPT or wiring a ChatGPT plugin to a real backend is one of the most common press patterns we see.",
      },
      {
        q: "Can the engineer help with Azure OpenAI?",
        a: "Yes. Common in regulated industries; the engineer covers the routing, the auth, and the latency-sensitive bits.",
      },
    ],
  },
  copilot: {
    slug: "copilot",
    name: "GitHub Copilot",
    vendor: "Microsoft",
    oneLiner:
      "Copilot lives inside the IDE. The press is for the moments Copilot isn't enough on its own.",
    metaDescription:
      "GitHub Copilot stuck on a refactor or PR? A software engineer joins your IDE in seconds. Debug, deploy, harden — same engineer, same session.",
    moments: [
      {
        title: "When Copilot's suggestions stop being useful",
        body: "Mid-refactor, in unfamiliar code, against a non-mainstream framework — Copilot's prediction quality drops. The press surfaces an engineer who knows the framework.",
      },
      {
        title: "When the PR review needs a real reviewer",
        body: "Copilot Workspace is excellent for first-draft review. For PRs where one wrong merge costs a week, a software engineer joins and reviews live.",
      },
      {
        title: "When the build is enterprise-shaped",
        body: "Copilot in an enterprise context — SSO, code policies, compliance — has a different shape. A Relay engineer who's stood it up before walks the team through the rollout.",
      },
    ],
    faq: [
      {
        q: "Do you support Copilot Workspace?",
        a: "Yes. PR-level review, plan generation, and the agent-driven changes — engineers are familiar with the surface.",
      },
      {
        q: "What about Copilot Chat?",
        a: "Yes. The engineer can pair with you inside VS Code, Visual Studio, or JetBrains — wherever Copilot Chat lives.",
      },
      {
        q: "Does Copilot's enterprise plan integrate?",
        a: "We don't integrate at the API level — we integrate at the human level. Engineers join your screen, regardless of the plan you're on.",
      },
    ],
  },
  gemini: {
    slug: "gemini",
    name: "Gemini",
    vendor: "Google",
    oneLiner:
      "Gemini's strength is multimodal and long-context. The press is for the moments that need execution, not analysis.",
    metaDescription:
      "Gemini code generation stuck? Workspace integration broken? A software engineer joins your build in seconds — same engineer across sessions.",
    moments: [
      {
        title: "When the multimodal output needs to ship",
        body: "Gemini's vision and long-context strengths produce excellent analysis. Turning that analysis into a deployed feature is the press.",
      },
      {
        title: "When Workspace integration is the blocker",
        body: "Gmail, Docs, Drive, Calendar — Workspace add-ons have a steep curve. A Relay engineer who's shipped them before joins the screen and walks it.",
      },
      {
        title: "When the Vertex AI deploy doesn't behave",
        body: "Vertex's surface is large; the press surfaces an engineer who knows the corner of it you're stuck in.",
      },
    ],
    faq: [
      {
        q: "Do you support Gemini Pro and Gemini Flash?",
        a: "Yes — every Gemini model, including the latest 1.5 and 2.0 variants.",
      },
      {
        q: "What about Google AI Studio?",
        a: "Yes. The engineer can pair with you in AI Studio for prompt-engineering work and walk the move into production code.",
      },
      {
        q: "Vertex AI on GCP?",
        a: "Yes. Includes Vertex auth, IAM, and the routing through cloud functions or Cloud Run — common press scenarios.",
      },
    ],
  },
};

export const TOOL_SLUGS = Object.keys(TOOLS);
