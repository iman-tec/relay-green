/*
 * Per-post Metadata + Open Graph + JSON-LD helper.
 *
 * Every article / research / white-paper / guide / customer-story page
 * imports this and exports the result as its `metadata`. Centralizes:
 *   • title (no "Relay ," prefix; the layout template appends "· Relay")
 *   • description
 *   • canonical URL
 *   • Open Graph type "article" with author, published time, section
 *   • Twitter card
 *
 * Article-specific JSON-LD (Article + BreadcrumbList) is emitted by the
 * shared <ArticleShell> / <WhitePaperShell> components, see those files.
 */

import type { Metadata } from "next";
import { CATEGORY_LABEL, type Post } from "./posts";

const SITE_URL = "https://www.relay.green";

function postUrl(p: Post): string {
  return `/resources/${p.category}/${p.slug}`;
}

export function metadataForPost(post: Post): Metadata {
  const url = postUrl(post);
  const section = CATEGORY_LABEL[post.category];

  return {
    title: post.title,
    description: post.lede,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: "Relay",
      title: post.title,
      description: post.lede,
      images: [
        {
          url: `${SITE_URL}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
      // Use the post's slug-segment OG image when available, else the default.
      // Each post folder may colocate its own opengraph-image.tsx; if not,
      // Next.js falls back up the tree to the root /opengraph-image.
      publishedTime: post.sortDate,
      modifiedTime: post.sortDate,
      authors: [post.byline ?? "Relay"],
      section,
      tags: [post.tag, section],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.lede,
      images: [`${SITE_URL}/opengraph-image`],
    },
    other: {
      "article:published_time": post.sortDate,
      "article:section": section,
      ...(post.byline ? { "article:author": post.byline } : {}),
    },
  };
}

export { postUrl };
export const articleAbsoluteUrl = (post: Post): string =>
  `${SITE_URL}${postUrl(post)}`;
