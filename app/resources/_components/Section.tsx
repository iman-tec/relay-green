/*
 * Sub-section heading inside a long-form piece. Used by research, white
 * papers, and guides for numbered or named subheads. Renders an anchored h2
 * so a TOC can jump to it.
 */

import type { ReactNode } from "react";

export function Section({
  id,
  eyebrow,
  heading,
  children,
}: {
  id: string;
  eyebrow?: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      style={{ scrollMarginTop: 96, marginTop: 40, marginBottom: 8 }}
    >
      {eyebrow ? (
        <div className="r-num" style={{ marginBottom: 8 }}>
          {eyebrow}
        </div>
      ) : null}
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: 28,
          lineHeight: 1.2,
          margin: "0 0 16px",
          maxWidth: "32ch",
        }}
      >
        {heading}
      </h2>
      {children}
    </section>
  );
}
