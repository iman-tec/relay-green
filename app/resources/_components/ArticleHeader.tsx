/*
 * Inner header content for an individual resource piece — eyebrow line,
 * display H1, and lede. Inline-only: no <section> wrapper, no .r-wrap,
 * so the parent shell can position it inside its 2-column article grid
 * alongside a sticky meta rail. Use in both ArticleShell and
 * WhitePaperShell.
 */

import { RichTitle } from "./RichTitle";

type Props = {
  tag: string;
  byline?: string;
  date: string;
  readTime: string;
  titleHtml: string;
  lede: string;
};

export function ArticleHeader({
  tag,
  byline,
  date,
  readTime,
  titleHtml,
  lede,
}: Props) {
  const eyebrowParts = [tag, byline, date, readTime].filter(
    Boolean
  ) as string[];
  return (
    <header className="r-article-head">
      <span className="r-num">{eyebrowParts.join(" · ")}</span>
      <RichTitle
        as="h1"
        className="r-h-display"
        style={{ marginTop: 18 }}
        value={titleHtml}
      />
      <p className="r-lede" style={{ marginTop: 24, maxWidth: "60ch" }}>
        {lede}
      </p>
    </header>
  );
}
