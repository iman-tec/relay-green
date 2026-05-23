/*
 * Numbered references / further-reading list at the bottom of a white paper.
 * Each entry is a short citation; external links are allowed but not
 * required. Renders an ordered list with mono numbering.
 */

import type { ReactNode } from "react";

export type Reference = {
  label: string;
  href?: string;
  note?: ReactNode;
};

export function References({
  items,
  heading = "Further reading",
}: {
  items: Reference[];
  heading?: string;
}) {
  return (
    <section
      aria-label="References"
      style={{
        marginTop: 56,
        paddingTop: 32,
        borderTop: "1px solid var(--rule)",
        maxWidth: "62ch",
      }}
    >
      <div
        className="r-num"
        style={{ marginBottom: 16, letterSpacing: "0.1em" }}
      >
        , {heading}
      </div>
      <ol
        style={{
          margin: 0,
          paddingLeft: 22,
          listStyle: "decimal",
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--ink-soft)",
        }}
      >
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            {it.href ? (
              <a
                href={it.href}
                style={{
                  color: "var(--ink)",
                  borderBottom: "1px solid var(--rule)",
                  textDecoration: "none",
                }}
              >
                {it.label}
              </a>
            ) : (
              <span style={{ color: "var(--ink)" }}>{it.label}</span>
            )}
            {it.note ? (
              <span style={{ color: "var(--ink-mute)" }}>, {it.note}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
