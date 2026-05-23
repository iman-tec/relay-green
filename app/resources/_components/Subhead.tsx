/*
 * Inline H4-style subhead used inside research and longer essays for the
 * named sub-sections that don't warrant the full <Section> treatment.
 * Replaces the per-page h4Style const.
 */

import type { ReactNode } from "react";

export function Subhead({ children }: { children: ReactNode }) {
  return (
    <h4
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 500,
        fontSize: 22,
        marginTop: 32,
        marginBottom: 12,
      }}
    >
      {children}
    </h4>
  );
}
