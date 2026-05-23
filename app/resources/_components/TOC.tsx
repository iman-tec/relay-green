/*
 * Table of contents for a white paper. Renders as a bordered side-block on
 * wide screens and as a top-of-page block on narrow ones. Anchors the
 * <Section id="..."> ids defined inside the body.
 */

type Item = { id: string; label: string };

export function TOC({ items }: { items: Item[] }) {
  return (
    <nav
      aria-label="Contents"
      style={{
        margin: "8px 0 32px",
        padding: "20px 24px",
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        borderRadius: 6,
        maxWidth: "62ch",
      }}
    >
      <div
        className="r-num"
        style={{ marginBottom: 12, letterSpacing: "0.1em" }}
      >
        Contents
      </div>
      <ol
        style={{
          margin: 0,
          paddingLeft: 24,
          listStyle: "decimal",
          fontFamily: "var(--font-display)",
          fontSize: 17,
          lineHeight: 1.7,
          color: "var(--ink-soft)",
        }}
      >
        {items.map((it) => (
          <li key={it.id} style={{ marginBottom: 4 }}>
            <a
              href={`#${it.id}`}
              style={{
                color: "inherit",
                textDecoration: "none",
                borderBottom: "1px solid transparent",
              }}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
