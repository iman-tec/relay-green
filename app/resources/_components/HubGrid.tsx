/*
 * Shared grid of resource cards. Reused by the top-level /resources hub and
 * by every sub-section index (articles, research, white-papers, guides,
 * customer-stories). When `showTag` is false the category chip is hidden ,
 * use that on sub-section indexes where the URL is the category.
 */

import Link from "next/link";
import { postUrl, type Post } from "../_data/posts";

export function HubGrid({
  posts,
  showTag = true,
}: {
  posts: Post[];
  showTag?: boolean;
}) {
  return (
    <div className="r-insights-grid">
      {posts.map((p) => (
        <Link key={p.slug} href={postUrl(p)} className="r-insight">
          {showTag ? <span className="r-insight-tag">{p.tag}</span> : null}
          <h3 className="r-insight-title">{p.title}</h3>
          <span className="r-insight-meta">
            {p.date} · {p.readTime}
          </span>
        </Link>
      ))}
    </div>
  );
}
