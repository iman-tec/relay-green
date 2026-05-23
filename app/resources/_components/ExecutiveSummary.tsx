/*
 * Boxed executive-summary block at the top of a white paper. A short
 * standalone read for the person who only has 90 seconds for the document.
 * Bullets + a one-line takeaway.
 */

export function ExecutiveSummary({
  takeaway,
  bullets,
}: {
  takeaway: string;
  bullets: string[];
}) {
  return (
    <aside
      aria-label="Executive summary"
      style={{
        margin: "8px 0 32px",
        padding: "28px 32px",
        background: "var(--cream-2)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        maxWidth: "64ch",
      }}
    >
      <div
        className="r-num"
        style={{ marginBottom: 12, letterSpacing: "0.1em" }}
      >
        Executive summary
      </div>
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 22,
          lineHeight: 1.35,
          margin: "0 0 20px",
          color: "var(--green-deep)",
          maxWidth: "44ch",
        }}
      >
        {takeaway}
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: 20,
          fontSize: 15,
          lineHeight: 1.6,
          color: "var(--ink-soft)",
        }}
      >
        {bullets.map((b, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            {b}
          </li>
        ))}
      </ul>
    </aside>
  );
}
