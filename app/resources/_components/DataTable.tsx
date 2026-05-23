/*
 * Compact table for research and white-paper tables of figures. Tabular nums,
 * thin rules, no fills. Pass headers and a 2D array of cells.
 */

import type { ReactNode } from "react";

export function DataTable({
  caption,
  headers,
  rows,
}: {
  caption?: string;
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <figure style={{ margin: "32px 0", maxWidth: "62ch" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                scope="col"
                style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--rule)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-soft)",
                  fontWeight: 500,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  style={{
                    textAlign: ci === 0 ? "left" : "right",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--rule-soft)",
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption ? (
        <figcaption
          className="r-num"
          style={{
            marginTop: 10,
            color: "var(--ink-mute)",
            letterSpacing: "0.04em",
          }}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
