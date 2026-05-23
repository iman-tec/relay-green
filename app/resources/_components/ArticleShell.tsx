/*
 * Standard shell for an individual article, research piece, guide, or
 * customer story. Wraps the marketing <Shell>, renders the page header,
 * places the body inside a narrow reading column, surfaces a related-
 * reading rail when the page passes its `currentPost`, and closes with a
 * Try-Relay CTA banner.
 *
 * White papers use <WhitePaperShell> instead, which adds the TOC, executive
 * summary block, and references list.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { ArticleHeader } from "./ArticleHeader";
import { CtaBanner } from "./CtaBanner";
import { RelatedReading } from "./RelatedReading";
import type { Post } from "../_data/posts";
import { CATEGORY_LABEL } from "../_data/posts";
import { JsonLd } from "../../_marketing/JsonLd";
import {
  articleSchema,
  breadcrumbSchema,
  type JsonLdObject,
} from "../../../lib/seo/schema";

const SITE_URL = "https://www.relay.green";

type Props = {
  tag: string;
  byline?: string;
  date: string;
  readTime: string;
  titleHtml: string;
  lede: string;
  ctaHeadlineHtml: string;
  /**
   * The post being rendered. When provided, ArticleShell appends a
   * related-reading rail just before the marketing CTA, so the foot of
   * an article isn't a dead-end. Optional for backwards compatibility.
   */
  currentPost?: Post;
  children: ReactNode;
};

export function ArticleShell({
  tag,
  byline,
  date,
  readTime,
  titleHtml,
  lede,
  ctaHeadlineHtml,
  currentPost,
  children,
}: Props) {
  const schemas: JsonLdObject[] = [];
  if (currentPost) {
    const url = `${SITE_URL}/resources/${currentPost.category}/${currentPost.slug}`;
    schemas.push(
      articleSchema({
        url,
        title: currentPost.title,
        description: currentPost.lede,
        datePublished: currentPost.sortDate,
        authorName: currentPost.byline ?? "Relay",
        section: CATEGORY_LABEL[currentPost.category],
      }),
      breadcrumbSchema([
        { name: "Resources", href: "/resources" },
        {
          name: CATEGORY_LABEL[currentPost.category],
          href: `/resources/${currentPost.category}`,
        },
        {
          name: currentPost.title,
          href: `/resources/${currentPost.category}/${currentPost.slug}`,
        },
      ])
    );
  }

  const categoryHref = currentPost
    ? `/resources/${currentPost.category}`
    : "/resources";
  const categoryLabel = currentPost
    ? CATEGORY_LABEL[currentPost.category]
    : "Resources";

  return (
    <Shell>
      {schemas.length > 0 ? <JsonLd data={schemas} /> : null}

      {/* Single centered reading column — the standard editorial pattern
          (Stripe Press, NYT longform, Substack pro). A small back-link
          row floats above, then the ArticleHeader (eyebrow meta strip +
          title + lede), then the body. Width tuned to 820 px so the
          title earns its own line at display sizes while the body
          paragraphs stay at a comfortable ~62 ch reading measure. */}
      <section className="r-article-layout">
        <div className="r-article-column">
          <Link href={categoryHref} className="r-article-back">
            <span aria-hidden="true">←</span> {categoryLabel}
          </Link>
          <ArticleHeader
            tag={tag}
            byline={byline}
            date={date}
            readTime={readTime}
            titleHtml={titleHtml}
            lede={lede}
          />
          <article className="r-article-body">{children}</article>
        </div>
      </section>

      {currentPost ? <RelatedReading currentPost={currentPost} /> : null}

      <CtaBanner headlineHtml={ctaHeadlineHtml} />
    </Shell>
  );
}
