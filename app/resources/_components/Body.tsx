/*
 * Long-form paragraph for resource pages. Replaces the per-page bodyStyle
 * const that the original four blog posts each redefined. Keeps the same
 * 16/1.65/62ch reading column.
 */

import type { ReactNode, CSSProperties } from "react";

export function Body({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  /* maxWidth removed so each paragraph fills its parent reading
     column. The container (.r-article-column) sets the reading
     measure; capping individual paragraphs here separately created a
     visible right-margin gap between the body and a wider title. */
  return (
    <p
      className="r-body"
      style={{
        fontSize: 16,
        lineHeight: 1.65,
        marginBottom: 14,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
