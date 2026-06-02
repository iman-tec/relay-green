/*
 * Quick RAG retrieval check (debug tool).
 *   npx tsx scripts/rag-check.ts <projectId> [question...]
 */
import "dotenv/config";
import { embedQuery } from "../lib/relay/rag/embed";
import { search, matchFilter } from "../lib/relay/rag/qdrant";

async function main() {
  const projectId = process.argv[2];
  const q = process.argv.slice(3).join(" ") || "what is this project about?";
  if (!projectId) throw new Error("usage: rag-check.ts <projectId> [question]");
  const v = await embedQuery(q);
  const hits = await search(v, matchFilter({ project_id: projectId }), 8);
  console.log(`Q: ${q}\n${hits.length} hits:\n`);
  for (const h of hits) {
    const p = h.payload as { source_type?: string; title?: string; text?: string };
    console.log(
      `${h.score.toFixed(3)}  ${p.source_type} · ${p.title}\n   ${(p.text ?? "").slice(0, 140).replace(/\s+/g, " ")}…\n`,
    );
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
