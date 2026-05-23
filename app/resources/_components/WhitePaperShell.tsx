/*
 * Shell for a white-paper-length piece. Adds an executive summary, a table
 * of contents, and a numbered references list to the standard ArticleShell
 * pattern. The body is rendered inside a narrow reading column so the TOC
 * can sit above (mobile) or alongside (wide) without changing column width.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Shell } from "../../_marketing/Shell";
import { ArticleHeader } from "./ArticleHeader";
import { CtaBanner } from "./CtaBanner";
import { ExecutiveSummary } from "./ExecutiveSummary";
import { TOC } from "./TOC";
import { References, type Reference } from "./References";
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
  summary: { takeaway: string; bullets: string[] };
  toc: { id: string; label: string }[];
  references: Reference[];
  currentPost?: Post;
  children: ReactNode;
};

export function WhitePaperShell({
  tag,
  byline,
  date,
  readTime,
  titleHtml,
  lede,
  ctaHeadlineHtml,
  summary,
  toc,
  references,
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

      {/* Single centered reading column. Same editorial pattern as
          ArticleShell — for white papers the body sequence (summary
          → TOC → article → references) gives the page its structure;
          a side rail is unnecessary chrome. */}
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
          <ExecutiveSummary
            takeaway={summary.takeaway}
            bullets={summary.bullets}
          />
          <TOC items={toc} />
          <article className="r-article-body">{children}</article>
          <References items={references} />
        </div>
      </section>

      {currentPost ? <RelatedReading currentPost={currentPost} /> : null}

      <CtaBanner headlineHtml={ctaHeadlineHtml} />
    </Shell>
  );
}
