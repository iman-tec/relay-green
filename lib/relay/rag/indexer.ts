/*
 * RAG indexer — turns a project (and each of its sessions) into Qdrant points.
 *
 * What gets indexed per SESSION:
 *   • session_summary  — always (so even transcript-less old sessions are searchable)
 *   • voice_transcript — session_captions (Whisper/LTT)
 *   • chat             — guest_messages (human)
 *   • document         — PDF/DOCX/text attachments, full extracted text
 *
 * Per PROJECT (session_id = ""):
 *   • project_meta     — name + project summary + next steps
 *   • intake           — onboarding questionnaire
 *
 * Re-indexing is idempotent: a session's points are deleted (by session_id)
 * before re-upsert; project-meta points are deleted (project_id + empty
 * session_id) before re-upsert.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { ragServiceClient } from "./service";
import { embedTexts } from "./embed";
import {
  ensureCollection,
  upsertPoints,
  deleteByFilter,
  matchFilter,
  pointId,
  type QPoint,
} from "./qdrant";
import { chunkText } from "./chunk";
import { extractDocumentText, isParseableDocument } from "./extract";

// Re-exported for existing importers (backfill script, index-session route).
export { ragServiceClient };

type ChunkInput = {
  sourceType: string;
  sourceId: string;
  title: string;
  createdAt: string;
  text: string;
};

function buildPoints(
  projectId: string,
  sessionId: string | null,
  inputs: ChunkInput[]
): {
  texts: string[];
  meta: { id: string; payload: Record<string, unknown> }[];
} {
  const texts: string[] = [];
  const meta: { id: string; payload: Record<string, unknown> }[] = [];
  for (const inp of inputs) {
    const chunks = chunkText(inp.text);
    chunks.forEach((c, i) => {
      texts.push(c);
      meta.push({
        id: pointId(`${inp.sourceId}#${i}`),
        payload: {
          project_id: projectId,
          session_id: sessionId ?? "",
          source_type: inp.sourceType,
          source_id: inp.sourceId,
          title: inp.title,
          created_at: inp.createdAt,
          chunk: i,
          text: c,
        },
      });
    });
  }
  return { texts, meta };
}

async function embedAndUpsert(
  texts: string[],
  meta: { id: string; payload: Record<string, unknown> }[]
): Promise<number> {
  if (texts.length === 0) return 0;
  const vectors = await embedTexts(texts);
  const points: QPoint[] = meta.map((m, i) => ({
    id: m.id,
    vector: vectors[i],
    payload: m.payload,
  }));
  await upsertPoints(points);
  return points.length;
}

function nextStepsToString(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .map((x) =>
      typeof x === "string"
        ? x
        : x && typeof x === "object"
          ? String(
              (x as { text?: string; description?: string }).text ??
                (x as { description?: string }).description ??
                ""
            )
          : ""
    )
    .filter((s) => s.trim().length > 0)
    .join("; ");
}

export async function indexSession(
  sb: SupabaseClient,
  sessionId: string
): Promise<{ chunks: number; projectId: string | null; skipped?: string }> {
  await ensureCollection();
  const { data: s } = await sb
    .from("guest_calls")
    .select(
      "id, project_id, project_name, guest_name, created_at, ai_summary_title, ai_summary_overview, summary, status"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!s) return { chunks: 0, projectId: null, skipped: "session_not_found" };
  const projectId = (s.project_id as string | null) ?? null;
  if (!projectId) return { chunks: 0, projectId: null, skipped: "no_project" };
  const createdAt = (s.created_at as string) ?? new Date().toISOString();
  const title = (s.ai_summary_title as string | null) ?? "Session";
  const inputs: ChunkInput[] = [];

  // 1. Session summary — always (keeps transcript-less sessions searchable).
  const summaryParts = [
    s.ai_summary_title,
    s.ai_summary_overview,
    s.summary,
  ].filter(Boolean) as string[];
  if (summaryParts.length > 0) {
    inputs.push({
      sourceType: "session_summary",
      sourceId: `sess:${sessionId}:summary`,
      title,
      createdAt,
      text: summaryParts.join("\n\n"),
    });
  }

  // 2. Voice transcript.
  const { data: caps } = await sb
    .from("session_captions")
    .select("speaker, text, window_end")
    .eq("session_id", sessionId)
    .order("window_end", { ascending: true });
  const voice = (caps ?? [])
    .map(
      (c) =>
        `${(c as { speaker?: string }).speaker ?? "Speaker"}: ${(c as { text?: string }).text ?? ""}`
    )
    .join("\n")
    .trim();
  if (voice) {
    inputs.push({
      sourceType: "voice_transcript",
      sourceId: `sess:${sessionId}:voice`,
      title: `${title} — voice transcript`,
      createdAt,
      text: voice,
    });
  }

  // 3. Chat.
  const { data: msgs } = await sb
    .from("guest_messages")
    .select("sender_kind, sender_name, body, created_at")
    .eq("guest_call_id", sessionId)
    .order("created_at", { ascending: true });
  const chat = (msgs ?? [])
    .filter(
      (m) =>
        (m as { sender_kind?: string }).sender_kind !== "system" &&
        typeof (m as { body?: unknown }).body === "string" &&
        ((m as { body?: string }).body ?? "").trim().length > 0
    )
    .map(
      (m) =>
        `${(m as { sender_name?: string }).sender_name ?? (m as { sender_kind?: string }).sender_kind}: ${(m as { body?: string }).body}`
    )
    .join("\n")
    .trim();
  if (chat) {
    inputs.push({
      sourceType: "chat",
      sourceId: `sess:${sessionId}:chat`,
      title: `${title} — chat`,
      createdAt,
      text: chat,
    });
  }

  // 4. Documents (PDF / DOCX / text) attached anywhere in this session.
  const { data: atts } = await sb
    .from("guest_message_attachments")
    .select(
      "id, path, name, mime, kind, created_at, guest_messages!inner(guest_call_id)"
    )
    .eq("guest_messages.guest_call_id", sessionId);
  for (const a of (atts ?? []) as Array<{
    id: string;
    path: string;
    name: string;
    mime: string;
    created_at: string;
  }>) {
    if (!isParseableDocument(a.name, a.mime)) continue;
    try {
      const { data: blob } = await sb.storage
        .from("chat-attachments")
        .download(a.path);
      if (!blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      const text = await extractDocumentText(a.name, a.mime, buf);
      if (text && text.trim().length > 20) {
        inputs.push({
          sourceType: "document",
          sourceId: `att:${a.id}`,
          title: a.name,
          createdAt: a.created_at ?? createdAt,
          text,
        });
      }
    } catch (e) {
      console.warn(`[rag] document ${a.name} skipped:`, e);
    }
  }

  // Replace this session's points wholesale.
  await deleteByFilter(matchFilter({ session_id: sessionId }));
  const { texts, meta } = buildPoints(projectId, sessionId, inputs);
  const chunks = await embedAndUpsert(texts, meta);
  return { chunks, projectId };
}

export async function indexProjectMeta(
  sb: SupabaseClient,
  projectId: string
): Promise<{ chunks: number }> {
  await ensureCollection();
  const { data: p } = await sb
    .from("projects")
    .select("id, name, summary, ai_summary_overview, ai_next_steps, created_at")
    .eq("id", projectId)
    .maybeSingle();
  const createdAt = (p?.created_at as string) ?? new Date(0).toISOString();
  const inputs: ChunkInput[] = [];

  if (p) {
    const steps = nextStepsToString(p.ai_next_steps);
    const parts = [
      p.name ? `Project: ${p.name}` : "",
      p.ai_summary_overview as string | null,
      p.summary as string | null,
      steps ? `Next steps: ${steps}` : "",
    ].filter(Boolean) as string[];
    if (parts.length > 0) {
      inputs.push({
        sourceType: "project_meta",
        sourceId: `proj:${projectId}:meta`,
        title: (p.name as string) ?? "Project",
        createdAt,
        text: parts.join("\n\n"),
      });
    }
  }

  const { data: intake } = await sb
    .from("client_intakes")
    .select("familiarity, ai_tools_used, developing, technologies, created_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (intake) {
    const techs = Array.isArray(intake.technologies)
      ? (intake.technologies as string[]).join(", ")
      : "";
    const text = [
      `Building: ${intake.developing}`,
      techs ? `Tech stack: ${techs}` : "",
      `Customer familiarity: ${intake.familiarity}`,
      `AI tools used: ${intake.ai_tools_used}`,
    ]
      .filter(Boolean)
      .join("\n");
    inputs.push({
      sourceType: "intake",
      sourceId: `proj:${projectId}:intake`,
      title: "Onboarding intake",
      createdAt: (intake.created_at as string) ?? createdAt,
      text,
    });
  }

  // Quotes / bids raised on this project — so the assistant can answer
  // "what did we quote?", "what's the bid status?", "what scope/timeline?".
  const { data: quotes } = await sb
    .from("project_quote_requests")
    .select(
      "id, kind, status, quote_amount_cents, bid_scope, bid_timeline, comments, customer_response_note, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  for (const q of (quotes ?? []) as Array<{
    id: string;
    kind: string | null;
    status: string | null;
    quote_amount_cents: number | null;
    bid_scope: string | null;
    bid_timeline: string | null;
    comments: string | null;
    customer_response_note: string | null;
    created_at: string;
  }>) {
    const amount =
      q.quote_amount_cents != null
        ? `$${(q.quote_amount_cents / 100).toLocaleString()}`
        : "not set";
    const text = [
      `Quote/bid (${q.kind ?? "?"}) — status: ${q.status ?? "?"}`,
      `Amount: ${amount}`,
      q.bid_scope ? `Scope: ${q.bid_scope}` : "",
      q.bid_timeline ? `Timeline: ${q.bid_timeline}` : "",
      q.comments ? `Engineer notes: ${q.comments}` : "",
      q.customer_response_note
        ? `Customer response: ${q.customer_response_note}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    inputs.push({
      sourceType: "quote",
      sourceId: `quote:${q.id}`,
      title: `Quote · ${q.status ?? "?"}`,
      createdAt: q.created_at ?? createdAt,
      text,
    });
  }

  // Replace project-level (session_id = "") points.
  await deleteByFilter({
    must: [
      { key: "project_id", match: { value: projectId } },
      { key: "session_id", match: { value: "" } },
    ],
  });
  const { texts, meta } = buildPoints(projectId, null, inputs);
  const chunks = await embedAndUpsert(texts, meta);
  return { chunks };
}

export async function indexProject(
  sb: SupabaseClient,
  projectId: string
): Promise<{ sessions: number; chunks: number }> {
  let chunks = (await indexProjectMeta(sb, projectId)).chunks;
  const { data: sessions } = await sb
    .from("guest_calls")
    .select("id")
    .eq("project_id", projectId);
  let count = 0;
  for (const row of (sessions ?? []) as { id: string }[]) {
    const r = await indexSession(sb, row.id);
    chunks += r.chunks;
    count += 1;
  }
  return { sessions: count, chunks };
}
