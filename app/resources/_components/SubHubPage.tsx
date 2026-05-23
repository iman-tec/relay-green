/*
 * Shared layout for every category sub-hub (/resources/articles,
 * /resources/research, /resources/white-papers, /resources/guides,
 * /resources/customer-stories). Each route's page.tsx exports a Metadata
 * object and renders <SubHubPage category="..."/>.
 */

import { Shell } from "../../_marketing/Shell";
import { CtaBanner } from "../../_marketing/CtaBanner";
import { HubGrid } from "./HubGrid";
import {
  CATEGORY_LABEL,
  CATEGORY_LEDE,
  byCategory,
  type Category,
} from "../_data/posts";

export function SubHubPage({ category }: { category: Category }) {
  const posts = byCategory(category);
  return (
    <Shell>
      <section className="r-page-header">
        <div className="r-wrap">
          <span className="r-num">Resources · {CATEGORY_LABEL[category]}</span>
          <h1 className="r-h-display" style={{ marginTop: 18 }}>
            {CATEGORY_LABEL[category]}.
          </h1>
          <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
            {CATEGORY_LEDE[category]}
          </p>
        </div>
      </section>

      <section className="r-section">
        <div className="r-wrap">
          {posts.length > 0 ? (
            <HubGrid posts={posts} showTag={false} />
          ) : (
            <p className="r-lede" style={{ color: "var(--ink-mute)" }}>
              Nothing published in this section yet. Check back shortly.
            </p>
          )}
        </div>
      </section>

      {/* Shared closing banner — single source of truth for the
          conversion surface across every primary marketing page. */}
      <CtaBanner />
    </Shell>
  );
}
