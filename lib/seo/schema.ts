/*
 * JSON-LD schema.org generators.
 *
 * One module, one source of truth — every `<JsonLd>` block on the site is
 * built from these. Keep the helpers narrow: each returns a single object
 * literal that satisfies schema.org for its type, ready to be JSON-stringified
 * inside a <script type="application/ld+json"> element.
 *
 * Reference: https://schema.org/ — and the Google Rich Results validator at
 * https://validator.schema.org/ for sanity checks.
 */

const SITE_URL = "https://www.relay.green";
const SITE_NAME = "Relay";
const ORG_LEGAL_NAME = "Relay.green, Inc.";

export type JsonLdObject = Record<string, unknown>;

/* ── Organization ──────────────────────────────────────────────────────── */

export function organizationSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}#organization`,
    name: SITE_NAME,
    legalName: ORG_LEGAL_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/icon`,
      width: 192,
      height: 192,
    },
    image: `${SITE_URL}/opengraph-image`,
    description:
      "Relay puts a senior software engineer one press away from any AI build. Build with AI. Ship with engineers.",
    foundingDate: "2025",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Manhattan",
      addressRegion: "NY",
      addressCountry: "US",
    },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        email: "sales@relay.green",
        areaServed: ["US", "EU", "UK", "IN"],
        availableLanguage: ["English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@relay.green",
        availableLanguage: ["English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "press",
        email: "press@relay.green",
      },
      {
        "@type": "ContactPoint",
        contactType: "security",
        email: "security@relay.green",
      },
    ],
  };
}

/* ── WebSite ───────────────────────────────────────────────────────────── */

export function websiteSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: "Human engineers, in seconds, for AI-native builders.",
    publisher: { "@id": `${SITE_URL}#organization` },
    inLanguage: "en-US",
  };
}

/* ── BreadcrumbList ────────────────────────────────────────────────────── */

export type BreadcrumbItem = { name: string; href: string };

export function breadcrumbSchema(items: BreadcrumbItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.href === "/" ? "" : item.href}`,
    })),
  };
}

/* ── Article ───────────────────────────────────────────────────────────── */

export type ArticleSchemaInput = {
  url: string; // absolute URL of the article
  title: string;
  description: string;
  datePublished: string; // ISO 8601
  dateModified?: string; // ISO 8601
  authorName?: string;
  imageUrl?: string; // absolute URL
  section?: string; // e.g. "Articles", "Research", "White papers"
};

export function articleSchema(a: ArticleSchemaInput): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    mainEntityOfPage: { "@type": "WebPage", "@id": a.url },
    headline: a.title,
    description: a.description,
    datePublished: a.datePublished,
    dateModified: a.dateModified ?? a.datePublished,
    author: {
      "@type": "Organization",
      name: a.authorName ?? SITE_NAME,
      url: SITE_URL,
    },
    publisher: { "@id": `${SITE_URL}#organization` },
    image: a.imageUrl ?? `${SITE_URL}/opengraph-image`,
    articleSection: a.section,
    inLanguage: "en-US",
  };
}

/* ── FAQPage ───────────────────────────────────────────────────────────── */

export type FaqItem = { question: string; answer: string };

export function faqSchema(items: FaqItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

/* ── Service ───────────────────────────────────────────────────────────── */

export function serviceSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${SITE_URL}#service`,
    name: "Relay — on-demand human engineering for AI builds",
    description:
      "Press once. A software engineer joins your AI build in seconds — and stays with you from build to shipped to running.",
    provider: { "@id": `${SITE_URL}#organization` },
    areaServed: ["US", "EU", "UK", "IN"],
    serviceType: "On-demand software engineering",
    audience: {
      "@type": "Audience",
      audienceType:
        "AI-native builders, founders, product teams, and enterprise IT",
    },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      offerCount: 3,
      url: `${SITE_URL}/pricing`,
      description:
        "Three phases — Build, Launch and Go-Live, Maintain and Scale. One team across all three.",
    },
  };
}

/* ── VideoObject ──────────────────────────────────────────────────────── */

export type VideoSchemaInput = {
  name: string;
  description: string;
  thumbnailUrl: string; // absolute
  uploadDate: string; // ISO 8601
  contentUrl?: string;
  embedUrl?: string;
  transcript?: string; // full text
  duration?: string; // ISO 8601 duration, e.g. "PT45S"
};

export function videoSchema(v: VideoSchemaInput): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: v.name,
    description: v.description,
    thumbnailUrl: v.thumbnailUrl,
    uploadDate: v.uploadDate,
    contentUrl: v.contentUrl,
    embedUrl: v.embedUrl,
    duration: v.duration,
    transcript: v.transcript,
    publisher: { "@id": `${SITE_URL}#organization` },
  };
}

/* ── WebPage ───────────────────────────────────────────────────────────── */

export type WebPageSchemaInput = {
  url: string; // absolute
  name: string;
  description: string;
};

export function webPageSchema(p: WebPageSchemaInput): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": p.url,
    url: p.url,
    name: p.name,
    description: p.description,
    isPartOf: { "@id": `${SITE_URL}#website` },
    inLanguage: "en-US",
  };
}
