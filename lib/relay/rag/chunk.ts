/*
 * Word-boundary chunker with overlap. ~1600 chars (~400 tokens) per chunk,
 * ~200-char overlap so context isn't severed across boundaries.
 */
export function chunkText(text: string, maxChars = 1600, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= maxChars) return clean.length >= 20 ? [clean] : [];

  const tokens = clean.split(/(\s+)/); // keep whitespace separators
  const chunks: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    if (cur.length + tok.length > maxChars && cur.trim().length > 0) {
      chunks.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap)); // carry overlap tail
    }
    cur += tok;
  }
  if (cur.trim().length >= 20) chunks.push(cur.trim());
  return chunks;
}
