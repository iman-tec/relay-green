import Link from "next/link";
import { JsonLd } from "./JsonLd";
import { breadcrumbSchema, type BreadcrumbItem } from "../../lib/seo/schema";

/*
 * Visible breadcrumb trail + matching BreadcrumbList JSON-LD.
 *
 * Place above the H1 on nested routes (/trust/*, /legal/*, /company/*,
 * /resources/<category>/<slug>, /for/<tool>). The current page is rendered
 * as plain text (last item, not a link) per WAI-ARIA breadcrumb pattern.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  const trail = items.slice(0, -1);

  return (
    <nav
      aria-label="Breadcrumb"
      className="r-breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ink-soft)",
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <ol
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          listStyle: "none",
          margin: 0,
          padding: 0,
          flexWrap: "wrap",
        }}
      >
        {trail.map((item) => (
          <li
            key={item.href}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <Link
              href={item.href}
              style={{
                color: "var(--ink-soft)",
                textDecoration: "none",
                borderBottom: "1px dotted currentColor",
              }}
            >
              {item.name}
            </Link>
            <span aria-hidden="true">/</span>
          </li>
        ))}
        <li aria-current="page" style={{ color: "var(--ink)" }}>
          {last.name}
        </li>
      </ol>
      <JsonLd data={breadcrumbSchema(items)} />
    </nav>
  );
}
