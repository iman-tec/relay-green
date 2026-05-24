import type { MetadataRoute } from "next";

/*
 * /robots.txt, minimal, permissive policy with two AEO signals:
 *
 * 1. `host` declares the canonical hostname (www.relay.green) so any
 *    crawler that happens to find content via the apex (relay.green) or
 *    a Vercel preview URL knows where to consolidate authority.
 *
 * 2. `sitemap` points to the dynamic sitemap at /sitemap.xml so search
 *    engines and AI answer engines pick up new resources automatically.
 *
 * The codebase already uses /llms.txt for AI-specific structured indexing;
 * this file complements that for traditional web crawlers.
 */

const SITE_URL = "https://www.relay.green";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // API endpoints, no public crawling.
          "/api/",
          // Internal editorial planning page.
          "/sitemap-and-content-plan",
          // Demo authentication and role-gated dashboards. These are
          // Phase 0 demo surfaces, not part of the public marketing site.
          "/login",
          "/customer",
          "/engineer",
          "/supervisor",
          "/enterprise",
          "/admin",
          "/staff/",
          "/dashboard",
          "/inbox",
          "/triage",
          "/supervise",
          "/reseller",
          "/department",
          "/account",
          "/room",
          "/intake",
          "/payment",
          "/set-password",
          "/widget/",
          // Static-HTML design-exploration alternates served from /public.
          // These are internal references, not part of the public site;
          // their meta, OG, and viewport conflict with the canonical pages
          // and would split crawl signal if indexed.
          "/aaklmblue/",
          "/espresso/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
