import type { JsonLdObject } from "../../lib/seo/schema";

/*
 * Server component that emits one or more <script type="application/ld+json">
 * blocks. Pass any helper output from lib/seo/schema.ts directly.
 *
 * SAFETY: This component is intentionally NOT for arbitrary user input. It is
 * only fed by lib/seo/schema.ts helpers which build object literals from
 * compile-time strings or our own database (article titles, ledes, etc.). The
 * content is then JSON.stringify'd, which escapes everything except the four
 * sequences below, `</script>` and the unicode line separators U+2028 /
 * U+2029, that JSON.stringify alone does NOT escape. We escape those here as
 * defense-in-depth, even though our inputs never contain them in practice.
 *
 * dangerouslySetInnerHTML is required: React strips <script> children so
 * there is no other way to emit raw JSON into the document head/body.
 */

function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(item) }}
        />
      ))}
    </>
  );
}
