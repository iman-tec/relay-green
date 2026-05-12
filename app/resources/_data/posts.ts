/*
 * Single typed registry for the Resources section.
 *
 * Holds metadata for every published piece (Articles, Research, White papers,
 * Guides, Customer stories). Body content lives in each per-slug page.tsx;
 * everything else (title, lede, date, reading time, byline, category) lives
 * here so the top-level hub, the five sub-hubs, and the sitemap consume one
 * source of truth.
 *
 * Conventions:
 *   - sortDate is YYYY-MM-DD; lists are sorted desc by sortDate.
 *   - titleHtml is optional; when present it carries the <em> spans for
 *     display on the piece's own page header. The plain `title` is used in
 *     hub cards (no HTML there).
 *   - `byline` shows in the eyebrow line on the piece's page header.
 *   - `featured: true` pins a single piece on the top hub.
 */

export type Category =
  | "articles"
  | "research"
  | "white-papers"
  | "guides"
  | "customer-stories";

export type Tag =
  | "Essay"
  | "Field notes"
  | "Research"
  | "White paper"
  | "Guide"
  | "Customer story"
  | "Policy"
  | "Industry essay";

export type Post = {
  slug: string;
  category: Category;
  tag: Tag;
  title: string;
  titleHtml?: string;
  lede: string;
  date: string;
  sortDate: string;
  readTime: string;
  byline?: string;
  featured?: boolean;
};

export const CATEGORY_LABEL: Record<Category, string> = {
  articles: "Articles",
  research: "Research",
  "white-papers": "White papers",
  guides: "Guides",
  "customer-stories": "Customer stories",
};

export const CATEGORY_LEDE: Record<Category, string> = {
  articles:
    "Essays, field notes, and industry pieces on the human layer behind AI-built software.",
  research:
    "What we learn from running the bench. Numbers, methods, and what they imply.",
  "white-papers":
    "Long-form work for the people deciding whether AI-built software is allowed to ship.",
  guides:
    "Practical, step-through references for buyers and builders. Plainspoken, executable.",
  "customer-stories":
    "How real teams use a press to ship things they otherwise wouldn’t have shipped.",
};

export const POSTS: Post[] = [
  // ─── Articles ───────────────────────────────────────────────────────────
  {
    slug: "the-irreducibly-human-moment",
    category: "articles",
    tag: "Essay",
    title: "The irreducibly human moment in software",
    titleHtml: "The irreducibly <em>human moment</em> in software.",
    lede: "An argument for why software engineering doesn’t shrink in the age of AI, it sharpens, and moves to a new place in the build.",
    date: "May 2026",
    sortDate: "2026-05-12",
    readTime: "11 min read",
    byline: "By the founders",
    featured: true,
  },
  {
    slug: "anatomy-of-the-handoff",
    category: "articles",
    tag: "Field notes",
    title:
      "Anatomy of the handoff: what we learned shipping the first 1,000 sessions",
    titleHtml: "Anatomy of <em>the handoff.</em>",
    lede: "A median match in seconds isn’t a marketing number; it’s a system constraint we engineered toward and missed by 16 seconds in the first month.",
    date: "April 2026",
    sortDate: "2026-04-22",
    readTime: "9 min read",
    byline: "Engineering",
  },
  {
    slug: "softwares-coal-moment",
    category: "articles",
    tag: "Essay",
    title: "Software’s coal moment",
    titleHtml: "Software’s <em>coal moment.</em>",
    lede: "Why cheaper code means more engineers, not fewer, and why the new work is denser than the old work it replaced.",
    date: "May 2026",
    sortDate: "2026-05-05",
    readTime: "10 min read",
    byline: "By the founders",
  },
  {
    slug: "a-craftspersons-code",
    category: "articles",
    tag: "Policy",
    title: "A craftsperson’s code",
    titleHtml: "A <em>craftsperson’s</em> code.",
    lede: "The principles every Relay engineer signs before they ever take a press. Written down so a customer can hold us to them.",
    date: "May 2026",
    sortDate: "2026-05-08",
    readTime: "8 min read",
    byline: "Standards",
  },
  {
    slug: "the-shape-of-an-enterprise-that-builds",
    category: "articles",
    tag: "Essay",
    title: "The shape of an enterprise that builds",
    titleHtml: "The shape of an <em>enterprise that builds.</em>",
    lede: "What 2026 looks like inside a Fortune 500, when most of the software is written outside engineering, and most of engineering is doing something else.",
    date: "May 2026",
    sortDate: "2026-05-02",
    readTime: "12 min read",
    byline: "By the founders",
  },
  {
    slug: "what-we-look-for-in-a-relay-engineer",
    category: "articles",
    tag: "Field notes",
    title: "What we look for in a Relay engineer",
    titleHtml: "What we look for in a <em>Relay engineer.</em>",
    lede: "The bar, in writing. Five things a person has to bring to the press, and three we’ve learned not to test for.",
    date: "April 2026",
    sortDate: "2026-04-28",
    readTime: "7 min read",
    byline: "Hiring",
  },
  {
    slug: "why-we-dont-do-tiers",
    category: "articles",
    tag: "Field notes",
    title: "Why we don’t do tiers",
    titleHtml: "Why we don’t do <em>tiers.</em>",
    lede: "Every other on-demand service segments engineers by seniority and bills you accordingly. We don’t. Here’s how we keep the bar flat.",
    date: "April 2026",
    sortDate: "2026-04-18",
    readTime: "6 min read",
    byline: "Engineering",
  },
  {
    slug: "one-year-in",
    category: "articles",
    tag: "Essay",
    title: "One year in",
    titleHtml: "<em>One year</em> in.",
    lede: "What changed, what didn’t, and the one thing we got wrong about how the work would feel.",
    date: "May 2026",
    sortDate: "2026-05-15",
    readTime: "9 min read",
    byline: "By the founders, anniversary essay",
  },
  {
    slug: "healthcare-grade-software",
    category: "articles",
    tag: "Industry essay",
    title: "Healthcare-grade software in the age of the AI builder",
    titleHtml:
      "<em>Healthcare-grade</em> software, in the age of the AI builder.",
    lede: "Clinical-grade software has an evidence bar that doesn’t bend. We look at what that means when the person at the keyboard is no longer an engineer.",
    date: "May 2026",
    sortDate: "2026-05-09",
    readTime: "11 min read",
    byline: "Industry essay",
  },
  {
    slug: "trading-floors-and-the-press",
    category: "articles",
    tag: "Industry essay",
    title:
      "Trading floors and the press: where AI builds meet the moments humans must own",
    titleHtml: "Trading floors and <em>the press.</em>",
    lede: "The financial system has a long memory of what bad code costs at market open. We look at where AI-built software does and doesn’t belong on the desk.",
    date: "May 2026",
    sortDate: "2026-05-10",
    readTime: "12 min read",
    byline: "Industry essay",
  },

  // ─── Research ───────────────────────────────────────────────────────────
  {
    slug: "when-does-an-ai-build-want-a-person",
    category: "research",
    tag: "Research",
    title:
      "When does an AI build want a person? A study of 4,200 stuck moments",
    titleHtml: "When does an <em>AI build</em><br />want a person?",
    lede: "We logged every press in the first quarter of the private beta. Four patterns explain almost everything.",
    date: "April 2026",
    sortDate: "2026-04-15",
    readTime: "17 min read",
    byline: "Relay Research",
  },
  // ─── White papers ───────────────────────────────────────────────────────
  {
    slug: "hipaa-and-the-press",
    category: "white-papers",
    tag: "White paper",
    title: "HIPAA and the press: training a bench for PHI",
    titleHtml: "HIPAA and <em>the press.</em>",
    lede: "How we trained, certified, and segmented a bench of engineers to handle protected health information at the moment a builder presses for help.",
    date: "May 2026",
    sortDate: "2026-05-06",
    readTime: "32 min read",
    byline: "Relay Engineering · Compliance",
  },
  {
    slug: "compliance-architecture-for-ai-built-software",
    category: "white-papers",
    tag: "White paper",
    title: "Compliance architecture for AI-built software",
    titleHtml: "Compliance architecture for <em>AI-built software.</em>",
    lede: "Audit trails, the sessioned record, and what SOC 2 + ISO 27001 actually require when most of the code in your company isn’t written by your engineers.",
    date: "May 2026",
    sortDate: "2026-05-07",
    readTime: "38 min read",
    byline: "Relay Engineering · Trust",
  },
  {
    slug: "the-press-taxonomy",
    category: "white-papers",
    tag: "White paper",
    title:
      "The press taxonomy: a field guide to the four moments AI hands off to a person",
    titleHtml: "The <em>press taxonomy.</em>",
    lede: "A framework for engineering managers and platform teams: how to instrument your own AI-build workflow for the four moments humans should own.",
    date: "May 2026",
    sortDate: "2026-05-11",
    readTime: "34 min read",
    byline: "Relay Research · Engineering",
  },

  // ─── Guides ─────────────────────────────────────────────────────────────
  {
    slug: "buyers-guide-to-on-demand-engineering",
    category: "guides",
    tag: "Guide",
    title: "A buyer’s guide to on-demand engineering",
    titleHtml: "A buyer’s guide to <em>on-demand engineering.</em>",
    lede: "Vendor-evaluation criteria for human-in-the-loop services. The questions to ask, the answers that matter, the procurement traps to avoid.",
    date: "May 2026",
    sortDate: "2026-05-13",
    readTime: "24 min read",
    byline: "For CTOs and VPs of Engineering",
  },
  {
    slug: "ai-built-prototype-to-production-playbook",
    category: "guides",
    tag: "Guide",
    title: "From AI-built prototype to production: a 30-day playbook",
    titleHtml: "From AI-built prototype to <em>production.</em>",
    lede: "Day-by-day checklist for hardening an AI-generated codebase: code review, tests, infra, security, observability, deploy, and the day-31 question.",
    date: "May 2026",
    sortDate: "2026-05-14",
    readTime: "26 min read",
    byline: "For founders and product leads",
  },

  // ─── Customer stories ──────────────────────────────────────────────────
  {
    slug: "two-person-marketing-team",
    category: "customer-stories",
    tag: "Customer story",
    title:
      "A two-person marketing team. Twenty internal tools. One engineer on call.",
    titleHtml: "Two-person team.<br /><em>Twenty internal tools.</em>",
    lede: "How a growth team at a mid-market SaaS company shipped a quarter of internal tools without filing a single ticket to engineering.",
    date: "April 2026",
    sortDate: "2026-04-10",
    readTime: "6 min read",
    byline: "Customer story",
  },
];

export const byCategory = (c: Category): Post[] =>
  POSTS.filter((p) => p.category === c).sort((a, b) =>
    b.sortDate.localeCompare(a.sortDate)
  );

export const allSorted = (): Post[] =>
  [...POSTS].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

export const featured = (): Post | undefined => POSTS.find((p) => p.featured);

export const findPost = (category: Category, slug: string): Post | undefined =>
  POSTS.find((p) => p.category === category && p.slug === slug);

export const postUrl = (p: Post): string =>
  `/resources/${p.category}/${p.slug}`;
