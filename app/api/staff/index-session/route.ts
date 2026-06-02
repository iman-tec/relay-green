/*
 * POST /api/staff/index-session
 *
 * Server-to-server RAG indexing endpoint. Called fire-and-forget by the
 * summarize-* edge functions whenever a session/project summary is (re)built,
 * so the Qdrant index stays current automatically.
 *
 * Auth: a shared secret header `x-index-secret` === RAG_INDEX_SECRET. Not a
 * user-facing route. Runs in the Node runtime because it parses PDFs/DOCX.
 *
 * Body:
 *   { session_id }                          — re-index one session + its project
 *   { project_id }                          — re-index a project's meta/quotes/intake
 *   { reconcile: true, lookbackMinutes? }   — re-index every project with activity
 *                                             in the window (the cron safety net)
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ragServiceClient,
  indexSession,
  indexProjectMeta,
  indexProject,
} from "@/lib/relay/rag/indexer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-index-secret");
  const expected = process.env.RAG_INDEX_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    session_id?: string;
    project_id?: string;
    reconcile?: boolean;
    lookbackMinutes?: number;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body */
  }

  const sb = ragServiceClient();
  try {
    // ── Reconcile: catch ANY recent change (sessions ending, quotes raised,
    //    edits) regardless of whether a direct trigger fired. Idempotent. ──
    if (body.reconcile) {
      const lookbackMin = Math.max(5, Math.min(1440, body.lookbackMinutes ?? 120));
      const since = new Date(Date.now() - lookbackMin * 60_000).toISOString();
      const projectIds = new Set<string>();
      const [gc, quotes] = await Promise.all([
        sb.from("guest_calls").select("project_id, updated_at").gte("updated_at", since).not("project_id", "is", null),
        sb.from("project_quote_requests").select("project_id, created_at").gte("created_at", since).not("project_id", "is", null),
      ]);
      for (const r of (gc.data ?? []) as { project_id: string | null }[]) if (r.project_id) projectIds.add(r.project_id);
      for (const r of (quotes.data ?? []) as { project_id: string | null }[]) if (r.project_id) projectIds.add(r.project_id);
      let reconciled = 0;
      let chunks = 0;
      for (const pid of projectIds) {
        try {
          const r = await indexProject(sb, pid);
          reconciled += 1;
          chunks += r.chunks;
        } catch (e) {
          console.warn(`[index-session] reconcile ${pid} failed:`, e);
        }
      }
      return NextResponse.json({ ok: true, lookbackMin, reconciled, chunks });
    }

    const result: Record<string, unknown> = { ok: true };
    if (body.session_id) {
      const r = await indexSession(sb, body.session_id);
      result.session = r;
      // Keep the project rollup fresh too (summary just changed).
      if (r.projectId) {
        result.projectMeta = await indexProjectMeta(sb, r.projectId);
      }
    } else if (body.project_id) {
      result.projectMeta = await indexProjectMeta(sb, body.project_id);
    } else {
      return NextResponse.json({ error: "session_id, project_id, or reconcile required" }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[index-session] failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
