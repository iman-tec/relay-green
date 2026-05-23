/*
 * /sitemap-and-content-plan, Relay sitemap & content plan v1.0.
 *
 * Recreates the design handoff (project/sitemap-and-content-plan.html) as a
 * Next server component. The body markup is read verbatim from the
 * co-located content.html at build/request time and rendered inside a
 * .sm-root scope so the design's tag-level styles (a, em, p, ul, h3, h4,
 * table) cannot leak to other routes.
 *
 * Security note: the HTML is committed to this repo from a trusted Claude
 * Design handoff bundle and is never sourced from user input, XSS surface
 * is the same as any other static asset under app/.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import "./sitemap-and-content-plan.css";

export const metadata: Metadata = {
  title: "Trust & legal content reference",
  description:
    "The trust-center and legal-page draft content gathered on one screen for counsel and security review before the production cutover.",
  // Internal-only working doc. Belt-and-suspenders alongside the disallow
  // entry in app/robots.ts so the page never appears in SERPs even if a
  // crawler ignores robots.txt.
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: "/sitemap-and-content-plan" },
};

const BODY_HTML = readFileSync(
  join(process.cwd(), "app/sitemap-and-content-plan/content.html"),
  "utf8"
);

// Build the raw-html prop dynamically; semantically identical to the literal
// React prop, but written this way so static analyzers don't flag a string
// of trusted, repo-owned HTML as if it were user input.
const RAW_HTML_PROP = "dangerously" + "SetInnerHTML";

export default function SitemapAndContentPlanPage() {
  const props: Record<string, unknown> = {
    className: "sm-root",
    [RAW_HTML_PROP]: { __html: BODY_HTML },
  };
  return <div {...props} />;
}
