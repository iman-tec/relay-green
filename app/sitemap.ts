/*
 * File-based sitemap. Emits an entry for every static marketing route plus
 * every published resource piece (driven by the resources registry, so new
 * pieces are picked up automatically when added there).
 */

import type { MetadataRoute } from "next";
import { POSTS, postUrl } from "./resources/_data/posts";

/* Canonical apex. Vercel redirects relay.green → www.relay.green at the
   edge so the sitemap should advertise the canonical form only. */
const SITE = "https://www.relay.green";

const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/product", priority: 0.9, changeFrequency: "monthly" },
  { path: "/for-enterprise", priority: 0.9, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.85, changeFrequency: "monthly" },
  { path: "/explainer", priority: 0.5, changeFrequency: "monthly" },

  // Tool-specific landing pages
  { path: "/for/cursor", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/lovable", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/replit", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/v0", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/bolt", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/claude", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/chatgpt", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/copilot", priority: 0.8, changeFrequency: "monthly" },
  { path: "/for/gemini", priority: 0.8, changeFrequency: "monthly" },

  { path: "/resources", priority: 0.9, changeFrequency: "weekly" },
  { path: "/resources/articles", priority: 0.8, changeFrequency: "weekly" },
  { path: "/resources/research", priority: 0.8, changeFrequency: "weekly" },
  { path: "/resources/white-papers", priority: 0.8, changeFrequency: "weekly" },
  { path: "/resources/guides", priority: 0.8, changeFrequency: "weekly" },
  {
    path: "/resources/customer-stories",
    priority: 0.7,
    changeFrequency: "weekly",
  },

  { path: "/company/about", priority: 0.6, changeFrequency: "monthly" },

  { path: "/trust", priority: 0.7, changeFrequency: "monthly" },
  { path: "/trust/privacy", priority: 0.6, changeFrequency: "monthly" },
  { path: "/trust/compliance", priority: 0.6, changeFrequency: "monthly" },
  { path: "/trust/data-handling", priority: 0.6, changeFrequency: "monthly" },
  { path: "/trust/subprocessors", priority: 0.5, changeFrequency: "monthly" },

  { path: "/legal/privacy-policy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/legal/terms-of-use", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/cookies", priority: 0.3, changeFrequency: "yearly" },

  { path: "/brand-guidelines", priority: 0.4, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries = STATIC_ROUTES.map<MetadataRoute.Sitemap[number]>(
    (r) => {
      // Attach video metadata to /explainer so Google's video sitemap
      // protocol can discover and index the 45-second product film.
      if (r.path === "/explainer") {
        return {
          url: `${SITE}${r.path}`,
          lastModified: now,
          changeFrequency: r.changeFrequency,
          priority: r.priority,
          videos: [
            {
              title: "Relay, See it in action",
              thumbnail_loc: `${SITE}/opengraph-image`,
              description:
                "60-second explainer: how Relay connects AI builders with software engineers, from press to launch to ongoing care.",
              content_loc: `${SITE}/explainer`,
              player_loc: `${SITE}/explainer`,
              duration: 45,
              family_friendly: "yes",
              live: "no",
            },
          ],
        };
      }
      return {
        url: `${SITE}${r.path}`,
        lastModified: now,
        changeFrequency: r.changeFrequency,
        priority: r.priority,
      };
    }
  );

  const resourceEntries = POSTS.map((p) => ({
    url: `${SITE}${postUrl(p)}`,
    lastModified: new Date(p.sortDate),
    changeFrequency: "monthly" as const,
    priority: p.featured ? 0.9 : 0.7,
  }));

  return [...staticEntries, ...resourceEntries];
}
