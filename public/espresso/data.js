// Relay — shared content data (used by both directions A and B)

window.RELAY_DATA = {
  // AI tools we support (homepage chip grid)
  aiTools: [
    { id: 'claude', name: 'Claude', glyph: 'C', color: '#D97757' },
    { id: 'cursor', name: 'Cursor', glyph: 'C', color: '#999999' },
    { id: 'lovable', name: 'Lovable', glyph: 'L', color: '#FF6B9D' },
    { id: 'chatgpt', name: 'ChatGPT', glyph: 'G', color: '#10A37F' },
    { id: 'replit', name: 'Replit', glyph: 'R', color: '#F26207' },
    { id: 'v0', name: 'v0', glyph: 'v', color: '#000000' },
    { id: 'bolt', name: 'Bolt', glyph: 'B', color: '#3B82F6' },
    { id: 'windsurf', name: 'Windsurf', glyph: 'W', color: '#0EA5E9' },
    { id: 'copilot', name: 'Copilot', glyph: 'M', color: '#6E40C9' },
    { id: 'gemini', name: 'Gemini', glyph: 'G', color: '#4285F4' },
  ],
  // Production stack we work with (long marquee)
  prodStack: [
    'Stripe','Adyen','PayPal','Razorpay','Paddle','Neon','Supabase','Postgres',
    'MongoDB','Redis','DynamoDB','MySQL','BigQuery','Snowflake','Firestore',
    'Vercel','Netlify','Cloudflare','AWS','GCP','Azure','Render','Fly.io','Railway',
    'DigitalOcean','SendGrid','Postmark','Resend','Twilio','Auth0','Clerk','WorkOS',
    'Okta','Firebase Auth','Cognito','Segment','PostHog','Mixpanel','Datadog','Sentry',
    'GitHub','GitLab','Linear','Figma','Slack','Salesforce','HubSpot','OpenAI','Anthropic','Pinecone',
  ],
  // Three phases — copy and pricing
  phases: [
    {
      id: 'build',
      num: '01',
      label: 'Build',
      tagline: 'You build. We support.',
      blurb: "Your AI does the writing. A real engineer is one press away the moment judgment is needed — CORS, webhooks, that deploy that won't.",
      plans: [
        { name: 'First session', price: 'Free', detail: '10 min on us' },
        { name: 'Base', price: '€50', detail: '100 min · 12 mo' },
        { name: 'Pro', price: '€100', detail: '240 min · 12 mo' },
        { name: 'Max', price: '€200', detail: '500 min · 12 mo' },
      ],
    },
    {
      id: 'launch',
      num: '02',
      label: 'Launch',
      tagline: 'You tell us when. We quote on complexity.',
      blurb: 'Going live is a discipline. Domains, SSL, observability, the 90% that\'s invisible until it breaks. A Relay engineer takes the wheel through launch on a calendar promise.',
      plans: [
        { name: 'Simple', price: '€1,500', detail: 'Single integration' },
        { name: 'Medium', price: '€3,000', detail: 'Multi-system, basic compliance' },
        { name: 'Complex', price: '€5,000', detail: 'Regulated · multi-region' },
        { name: 'Custom', price: '€—', detail: 'Quoted on your spec' },
      ],
    },
    {
      id: 'maintain',
      num: '03',
      label: 'Maintain',
      tagline: 'We take accountability. You focus on the business.',
      blurb: 'APIs change, dependencies break, traffic grows. Your engineer remembers why you chose that database, what the trade-offs were, what\'s next. Six months on, that memory is the product.',
      plans: [
        { name: 'Simple', price: '€1,000/mo', detail: 'Steady-state' },
        { name: 'Medium', price: '€4,500/mo', detail: 'Active iteration · on-call' },
        { name: 'Complex', price: '€8,000/mo', detail: 'Dedicated team · compliance' },
        { name: 'Custom', price: '€—', detail: 'Quoted on your spec' },
      ],
    },
  ],
  // Engineer cards — fictional but realistic
  engineers: [
    { name: 'Maya R.',     role: 'Backend & deploys',         loc: 'Berlin',  online: true,  in: '12s', stack: ['Node','Vercel','Postgres'], hue: 145 },
    { name: 'Tomás S.',    role: 'Payments & Stripe',         loc: 'Lisbon',  online: true,  in: '8s',  stack: ['Stripe','Adyen','Webhooks'], hue: 38 },
    { name: 'Priya N.',    role: 'Auth & SSO',                loc: 'London',  online: true,  in: '21s', stack: ['Clerk','WorkOS','Okta'],     hue: 280 },
    { name: 'Lior K.',     role: 'Data & migrations',         loc: 'Tel Aviv',online: false, in: '~4m', stack: ['Postgres','Neon','Redis'],   hue: 210 },
    { name: 'Aisha M.',    role: 'Frontend & perf',           loc: 'Lagos',   online: true,  in: '15s', stack: ['Next','Vite','Cloudflare'],  hue: 320 },
    { name: 'Diego F.',    role: 'Infra & on-call',           loc: 'Madrid',  online: true,  in: '9s',  stack: ['AWS','Fly','Render'],        hue: 95  },
    { name: 'Hana T.',     role: 'AI/ML integrations',        loc: 'Tokyo',   online: false, in: '~6m', stack: ['OpenAI','Pinecone','Cohere'],hue: 12  },
    { name: 'Connor B.',   role: 'Security & compliance',     loc: 'Dublin',  online: true,  in: '18s', stack: ['SOC2','GDPR','Audit'],       hue: 250 },
  ],
  // Live ticker numbers (seeded; ticked client-side)
  liveSeed: {
    online: 23,
    avgJoin: 14,
    sessionsToday: 142,
    launchesThisWeek: 8,
    minutesShipped: 28419,
  },
  // FAQ — cheeky tone
  faqs: [
    {
      q: "I'm not a developer. Will the engineer judge my AI-generated code?",
      a: "No. The engineers on Relay specifically work with AI-built code. They've seen every kind of Lovable, Cursor, and Replit project. They start where your code is, not where they wish it was. No rewrites for ego.",
    },
    {
      q: "What AI tools do you support?",
      a: "Lovable, Cursor, Replit, v0, Bolt, Windsurf, Claude, ChatGPT, Gemini, Copilot. If you built it with AI and it talks to the internet, we can help. Tell us your stack when you connect.",
    },
    {
      q: "Is my code and data safe?",
      a: "Sessions are private and ephemeral by default. Engineers sign an NDA before joining your call. GDPR-compliant. Enterprise gets dedicated regions and signed BAAs.",
    },
    {
      q: "What if I just need a quick answer, not an hour-long call?",
      a: "Sessions are 10-minute blocks. Past 10 minutes, you're billed by the minute for exactly the time you used. No hour-long minimum, no upsell theatre.",
    },
    {
      q: "Can I cancel my plan?",
      a: "Plans can't be cancelled once purchased, but they're valid for 12 months from the day you activate. Unused minutes carry across the year. So no, but also: you don't lose anything.",
    },
    {
      q: "Do you take on net-new builds from scratch?",
      a: "Relay is for builders who already have something — an AI prototype, an MVP, a live product. If you're starting from zero, build a v0 or Lovable prototype first, then bring us in.",
    },
    {
      q: "How is this different from hiring a freelancer or an agency?",
      a: "Freelancers vanish. Agencies discover scope. Relay is the same engineer from build to shipped to running — same Slack, same context, same accountability. You pay for minutes, not retainers.",
    },
  ],
  // Scripted demo sessions for "press the dot, see what happens"
  demos: [
    {
      id: 'deploy',
      title: 'Vercel deploy failing',
      stack: 'Lovable · Next.js',
      eng: { name: 'Maya', hue: 145 },
      lines: [
        { who: 'sys',  t: 0,    text: 'Maya joined · 12s' },
        { who: 'eng',  t: 700,  text: 'Hey — what AI built this?' },
        { who: 'you',  t: 2100, text: 'Lovable. Vercel build keeps failing.' },
        { who: 'eng',  t: 3600, text: "Got it. Sharing my screen — your env vars aren't scoped to Production." },
        { who: 'eng',  t: 5400, text: 'Fixing that and redeploying. 2 min.' },
        { who: 'sys',  t: 7000, text: '✓ Build green · live in 1m 48s' },
      ],
    },
    {
      id: 'stripe',
      title: 'Stripe webhook silently dropping',
      stack: 'Cursor · Node · Stripe',
      eng: { name: 'Tomás', hue: 38 },
      lines: [
        { who: 'sys',  t: 0,    text: 'Tomás joined · 8s' },
        { who: 'eng',  t: 600,  text: "Show me your Stripe dashboard's webhook log?" },
        { who: 'you',  t: 2000, text: 'Sent. 4xx on every event.' },
        { who: 'eng',  t: 3300, text: 'Signing secret is from test mode, your endpoint is live. Classic AI mistake.' },
        { who: 'eng',  t: 5100, text: 'Rotated. Webhooks flowing.' },
        { who: 'sys',  t: 6500, text: '✓ Last 24h backfilled · 318 events' },
      ],
    },
    {
      id: 'db',
      title: 'Postgres at 100% CPU',
      stack: 'Claude · Supabase',
      eng: { name: 'Lior', hue: 210 },
      lines: [
        { who: 'sys',  t: 0,    text: 'Lior joined · 21s' },
        { who: 'eng',  t: 700,  text: 'pg_stat_activity, please.' },
        { who: 'you',  t: 2200, text: 'Pasted. 400 idle in transaction.' },
        { who: 'eng',  t: 3700, text: "Your AI never set a statement_timeout. Adding it, plus an index on orders(user_id, created_at)." },
        { who: 'eng',  t: 5500, text: 'CPU back to 11%. Long-term plan in your Notion.' },
        { who: 'sys',  t: 7200, text: '✓ Resolved · 6m 14s session' },
      ],
    },
  ],
};
