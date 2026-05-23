/*
 * Boxed key-takeaway / warning panel for guides and white papers. Optional
 * `tone` chooses the accent color; default is the brand green.
 */

import type { ReactNode } from "react";

type Tone = "green" | "neutral";

export function Callout({
  label,
  children,
  tone = "green",
}: {
  label?: string;
  children: ReactNode;
  tone?: Tone;
}) {
  const accent = tone === "green" ? "var(--green)" : "var(--ink-soft)";
  return (
    <aside
      style={{
        margin: "28px 0",
        padding: "20px 24px",
        background: "var(--cream-2)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        maxWidth: "62ch",
      }}
    >
      {label ? (
        <div
          className="r-num"
          style={{ color: accent, marginBottom: 8, letterSpacing: "0.08em" }}
        >
          , {label}
        </div>
      ) : null}
      <div style={{ fontSize: 16, lineHeight: 1.6 }}>{children}</div>
    </aside>
  );
}
