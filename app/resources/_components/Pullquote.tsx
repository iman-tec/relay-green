/*
 * Inline pullquote with the brand's left-green-rule + serif italic treatment.
 * Used by essays and customer stories where a single line wants to stop the
 * reader. Replaces the per-page blockquoteStyle const.
 */

import type { ReactNode } from "react";

export function Pullquote({ children }: { children: ReactNode }) {
  return (
    <blockquote
      style={{
        borderLeft: "3px solid var(--green)",
        padding: "8px 0 8px 24px",
        margin: "24px 0",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontSize: 20,
        maxWidth: "56ch",
      }}
    >
      {children}
    </blockquote>
  );
}
