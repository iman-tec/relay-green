/*
 * Backfill the RAG index for EVERY existing project + session.
 *
 *   npx tsx scripts/backfill-rag.ts            # all projects
 *   npx tsx scripts/backfill-rag.ts <project>  # one project id
 *
 * Reads QDRANT_ENDPOINT, QDRANT_KEY, OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY from .env. Runs natively in Node — no dev server
 * or edge deploy needed.
 */
import "dotenv/config";
import { ragServiceClient, indexProject } from "../lib/relay/rag/indexer";
import { ensureCollection } from "../lib/relay/rag/qdrant";

async function main() {
  const only = process.argv[2];
  const sb = ragServiceClient();
  await ensureCollection();

  const ids = new Set<string>();
  if (only) {
    ids.add(only);
  } else {
    const { data: gc } = await sb
      .from("guest_calls")
      .select("project_id")
      .not("project_id", "is", null);
    for (const r of (gc ?? []) as { project_id: string | null }[])
      if (r.project_id) ids.add(r.project_id);
    const { data: pr } = await sb.from("projects").select("id");
    for (const r of (pr ?? []) as { id: string }[]) ids.add(r.id);
  }

  console.log(`Backfilling RAG for ${ids.size} project(s)…\n`);
  let i = 0;
  let totalChunks = 0;
  for (const id of ids) {
    i += 1;
    try {
      const r = await indexProject(sb, id);
      totalChunks += r.chunks;
      console.log(
        `[${i}/${ids.size}] ${id} → ${r.sessions} session(s), ${r.chunks} chunk(s)`
      );
    } catch (e) {
      console.error(
        `[${i}/${ids.size}] ${id} FAILED:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  console.log(
    `\nDone. ${totalChunks} chunk(s) indexed across ${ids.size} project(s).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
