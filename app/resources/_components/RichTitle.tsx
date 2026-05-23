/*
 * Render a hardcoded marketing title that may contain <em>...</em> spans
 * and <br /> breaks. Whitelist parser, anything outside that grammar is
 * rendered as plain text. No raw-HTML insertion.
 *
 * Inputs come from the resources registry (`titleHtml`) and from the
 * marketing pages that author CTA banners. All values are trusted at
 * author time and live in source.
 */

import type { ReactElement, CSSProperties } from "react";

type Token =
  | { kind: "text"; value: string }
  | { kind: "em"; value: string }
  | { kind: "br" };

const TAG_REGEX = /(<em>([\s\S]*?)<\/em>|<br ?\/?>)/gi;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  for (const match of input.matchAll(TAG_REGEX)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      tokens.push({ kind: "text", value: input.slice(lastIndex, matchIndex) });
    }
    const whole = match[1];
    if (whole.toLowerCase().startsWith("<br")) {
      tokens.push({ kind: "br" });
    } else {
      tokens.push({ kind: "em", value: match[2] ?? "" });
    }
    lastIndex = matchIndex + whole.length;
  }
  if (lastIndex < input.length) {
    tokens.push({ kind: "text", value: input.slice(lastIndex) });
  }
  return tokens;
}

export function renderRichTitle(input: string): ReactElement[] {
  return tokenize(input).map((t, i) => {
    if (t.kind === "br") return <br key={i} />;
    if (t.kind === "em") return <em key={i}>{t.value}</em>;
    return <span key={i}>{t.value}</span>;
  });
}

export function RichTitle({
  as: Tag = "span",
  className,
  style,
  value,
}: {
  as?: "h1" | "h2" | "h3" | "span" | "div";
  className?: string;
  style?: CSSProperties;
  value: string;
}) {
  return (
    <Tag className={className} style={style}>
      {renderRichTitle(value)}
    </Tag>
  );
}
