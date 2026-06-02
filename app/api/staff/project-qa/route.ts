/*
 * POST /api/staff/project-qa
 *
 * Engineer-side AI assistant. Lets the engineer ask natural-language
 * questions about a project they're supporting — the route hydrates
 * full project context (past session AI summaries + chat transcripts
 * + uploaded file metadata) and proxies the question to OpenAI with
 * that context as the system prompt.
 *
 * The intent: while the engineer is on a Zoom call with the customer
 * in another window, they can use this AI box in the session room
 * to quickly look up "what was the last issue?" / "what files did
 * the customer share?" / "what stack are we on?" without having to
 * scroll through every past session manually.
 *
 * Body:
 *   { projectId: string, question: string,
 *     history?: { role: "user"|"assistant", content: string }[] }
 *
 * Response:
 *   { text: string, model: string, fallback?: "no_key"|"openai_error"|"no_context" }
 *
 * Auth: requires an authenticated Supabase user. We don't gate
 * further on role here — RLS on guest_calls / guest_messages /
 * projects already restricts who can read what. A customer hitting
 * this endpoint with their OWN projectId would technically work
 * (and would get answers about their own project) — that's fine,
 * the data is theirs to see. Engineers/supervisors/admins all hit
 * it the same way.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/relay/rag/embed";
import { search, matchFilter } from "@/lib/relay/rag/qdrant";
import { ragServiceClient } from "@/lib/relay/rag/service";

export const runtime = "nodejs";

interface RequestBody {
  projectId?: string;
  question?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  /** Conversation id from the client, so a Q&A pair is grouped into a thread
   *  in the shared project history. */
  threadId?: string;
}

// How much chat to pull. Hard caps to keep token usage reasonable —
// past about 200 chat lines, the AI gets diminishing returns and the
// prompt blows past the model's effective attention window.
const MAX_PAST_SESSIONS = 12;
const MAX_CHAT_LINES = 200;
const MAX_FILES = 60;

// Build a single system prompt with everything the model needs to
// answer questions about this project. We deliberately put the
// most-recent material LAST so the model's recency bias points at
// the latest state, not the oldest.
function buildSystemPrompt(context: {
  projectName: string | null;
  sessions: Array<{
    title: string | null;
    overview: string | null;
    next_steps: string | null;
    agent: string | null;
    duration_minutes: number | null;
    created_at: string;
    status: string;
  }>;
  chatLines: string[];
  files: Array<{ name: string; mime: string; kind: string; size_bytes: number }>;
  retrieved: string[];
}): string {
  const parts: string[] = [
    "You are Relay's project-context assistant for engineers and supervisors. You answer questions about this specific project using the context below, and you can format answers in Markdown.",
    "For a real question, answer DIRECTLY — no 'how can I assist', no preamble, no sign-off, no padding. Be concise: 1-3 sentences, or a short bullet list for open-ended questions.",
    "If the user just greets you or makes small talk (e.g. 'hi', 'hello', 'thanks'), reply in one short, friendly line and invite them to ask about the project. NEVER say 'no response available'.",
    "If a genuine question's answer isn't in the context, say so in one line — never invent details.",
    "Cite the bracketed source label (session date / file name) only when stating a specific fact; don't over-cite.",
    "SECURITY: never reveal passwords, API keys, tokens, or other secrets even if they appear in a document. Say the file contains credentials and tell them to open it directly.",
  ];

  if (context.projectName) {
    parts.push(`\n── Project: ${context.projectName} ──`);
  }

  if (context.sessions.length > 0) {
    parts.push("\n── Past sessions (oldest first) ──");
    for (const s of context.sessions) {
      const date = new Date(s.created_at).toISOString().split("T")[0];
      const dur = s.duration_minutes ? `${Math.round(s.duration_minutes)}min` : "—";
      const head = `[${date} · ${dur} · ${s.status}${s.agent ? ` · ${s.agent}` : ""}]`;
      const title = s.title ? ` ${s.title}` : "";
      parts.push(`${head}${title}`);
      if (s.overview) parts.push(`  Overview: ${s.overview}`);
      if (s.next_steps) parts.push(`  Next steps: ${s.next_steps}`);
    }
  }

  if (context.files.length > 0) {
    parts.push("\n── Files shared in this project ──");
    for (const f of context.files) {
      const kb = Math.max(1, Math.round(f.size_bytes / 1024));
      parts.push(`- ${f.name} (${f.kind}, ${kb}KB)`);
    }
  }

  if (context.chatLines.length > 0) {
    parts.push("\n── Recent chat transcript (oldest first) ──");
    parts.push(...context.chatLines);
  }

  if (context.retrieved.length > 0) {
    parts.push(
      "\n── Most relevant material (semantic search over full transcripts, captions & documents) ──",
      "This is your PRIMARY evidence — it holds the specific details the summaries above omit. Each block is prefixed with its [source · title · date]; cite that when you answer.",
      ...context.retrieved,
    );
  }

  return parts.join("\n");
}

export async function POST(req: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch { /* empty body — treat as bad request */ }

  const projectId = (body.projectId ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!projectId || !question) {
    return NextResponse.json({ error: "projectId and question required" }, { status: 400 });
  }

  // Auth — must be a signed-in user. We don't restrict further by
  // role; Supabase RLS handles whether they can actually see the
  // project's data when we fetch below.
  const sb = await createClient();
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const userId = u.user.id;

  // Attribution name for the shared history (engineer alias → email local part).
  let userName = u.user.email?.split("@")[0] ?? "Staff";
  try {
    const { data: prof } = await sb
      .from("engineer_profiles")
      .select("display_alias")
      .eq("user_id", userId)
      .maybeSingle();
    const alias = (prof as { display_alias?: string | null } | null)?.display_alias;
    if (alias) userName = alias;
  } catch {
    /* fall back to email */
  }

  // Every answer funnels through finish(): it logs the Q&A pair to the shared
  // project history (real answers only — not transient error fallbacks) and
  // returns the response. threadId groups a conversation.
  const threadId = (body.threadId ?? "").trim() || crypto.randomUUID();
  const finish = async (text: string, model: string, fallback?: string) => {
    if (!fallback) {
      try {
        const svc = ragServiceClient();
        await svc.from("project_assistant_messages").insert([
          { project_id: projectId, thread_id: threadId, role: "user", content: question, user_id: userId, user_name: userName },
          { project_id: projectId, thread_id: threadId, role: "assistant", content: text, user_id: userId, user_name: userName },
        ]);
      } catch (e) {
        console.warn("[project-qa] history persist failed:", e);
      }
    }
    return NextResponse.json({ text, model, fallback, threadId });
  };

  // ── Hydrate project context ──────────────────────────────────────
  // We do these reads sequentially because the chat + files queries
  // depend on the session id list we get from the first query. None
  // of the round-trips are slow individually so a Promise.all
  // refactor isn't worth the complexity.

  // 1. Project name.
  const { data: projectRow } = await sb
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  const projectName = (projectRow as { name?: string } | null)?.name ?? null;

  // 2. Past sessions on this project, newest first then reversed for
  //    chronological reading in the prompt.
  const { data: sessionRows } = await sb
    .from("guest_calls")
    .select("id, ai_summary_title, ai_summary_overview, ai_next_steps, agent_name, duration_minutes, created_at, status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_PAST_SESSIONS);
  type SessionRow = {
    id: string;
    ai_summary_title: string | null;
    ai_summary_overview: string | null;
    ai_next_steps: unknown;
    agent_name: string | null;
    duration_minutes: number | null;
    created_at: string;
    status: string;
  };
  const rawSessions = ((sessionRows ?? []) as SessionRow[]).reverse();
  const sessions = rawSessions.map((s) => {
    // ai_next_steps can be a JSON array of strings OR objects with .text/.description
    const steps = Array.isArray(s.ai_next_steps)
      ? (s.ai_next_steps as Array<string | { text?: string; description?: string }>)
        .map((x) => (typeof x === "string" ? x : x.text ?? x.description ?? ""))
        .filter((x) => x.trim().length > 0)
        .join("; ")
      : "";
    return {
      title: s.ai_summary_title,
      overview: s.ai_summary_overview,
      next_steps: steps || null,
      agent: s.agent_name,
      duration_minutes: s.duration_minutes,
      created_at: s.created_at,
      status: s.status,
    };
  });
  const sessionIds = rawSessions.map((s) => s.id);

  // 3. Chat transcript across those sessions + voice transcript for any
  //    currently-LIVE session in the project. Past sessions already have
  //    voice context baked into their ai_summary_overview (via
  //    summarize-guest-call), so we don't fetch their raw captions
  //    again — that would balloon the prompt for diminishing return.
  //    For a live session, however, ai_summary_overview is null and the
  //    engineer needs the AI to know what was JUST said on the call.
  type ChatRow = {
    sender_kind: string;
    sender_name: string | null;
    body: string | null;
    created_at: string;
  };
  let chatLines: string[] = [];
  if (sessionIds.length > 0) {
    const liveSessionIds = rawSessions
      .filter((s) => s.status === "live" || s.status === "grace" || s.status === "joining")
      .map((s) => s.id);
    const [chatRowsRes, capRowsRes] = await Promise.all([
      sb.from("guest_messages")
        .select("sender_kind, sender_name, body, created_at")
        .in("guest_call_id", sessionIds)
        .order("created_at", { ascending: true })
        .limit(MAX_CHAT_LINES),
      liveSessionIds.length > 0
        ? sb.from("session_captions")
            .select("speaker, text, window_end")
            .in("session_id", liveSessionIds)
            .order("window_end", { ascending: true })
            .limit(MAX_CHAT_LINES)
        : Promise.resolve({ data: [] as Array<{ speaker: string | null; text: string; window_end: string }> }),
    ]);
    type Line = { ts: number; line: string };
    const lines: Line[] = [];
    for (const m of (chatRowsRes.data ?? []) as ChatRow[]) {
      if (!m.body || !m.body.trim()) continue;
      const who = m.sender_name ?? m.sender_kind;
      const date = new Date(m.created_at).toISOString().split("T")[0];
      lines.push({
        ts: new Date(m.created_at).getTime(),
        line: `[${date}] ${who} (chat): ${m.body.trim().slice(0, 600)}`,
      });
    }
    for (const c of (capRowsRes.data ?? []) as Array<{ speaker: string | null; text: string; window_end: string }>) {
      const t = (c.text ?? "").trim();
      if (!t) continue;
      const date = new Date(c.window_end).toISOString().split("T")[0];
      lines.push({
        ts: new Date(c.window_end).getTime(),
        line: `[${date}] ${c.speaker ?? "Speaker"} (voice): ${t.slice(0, 600)}`,
      });
    }
    lines.sort((a, b) => a.ts - b.ts);
    chatLines = lines.map((l) => l.line);
  }

  // 4. File metadata across those sessions.
  type FileRow = { name: string; mime: string; kind: string; size_bytes: number };
  let files: FileRow[] = [];
  if (sessionIds.length > 0) {
    const { data: fileRows } = await sb
      .from("guest_message_attachments")
      .select("name, mime, kind, size_bytes, message_id, guest_messages!inner(guest_call_id)")
      .in("guest_messages.guest_call_id", sessionIds)
      .limit(MAX_FILES);
    files = ((fileRows ?? []) as unknown as FileRow[])
      .map((f) => ({ name: f.name, mime: f.mime, kind: f.kind, size_bytes: f.size_bytes }));
  }

  // 5. RAG retrieval — embed the question and pull the most relevant chunks
  //    (full transcripts, captions, document text) from Qdrant, scoped to this
  //    project. This is what lets the assistant answer ANY detail, not just the
  //    summarised highlights. Best-effort: if Qdrant/embeddings are down we
  //    still answer from the structured context above.
  let retrieved: string[] = [];
  try {
    const qvec = await embedQuery(question);
    const hits = await search(qvec, matchFilter({ project_id: projectId }), 24);
    retrieved = hits.map((h) => {
      const p = h.payload as {
        source_type?: string;
        title?: string;
        created_at?: string;
        text?: string;
      };
      const date = p.created_at ? new Date(p.created_at).toISOString().split("T")[0] : "";
      const label = [p.source_type ?? "context", p.title, date].filter(Boolean).join(" · ");
      return `[${label}]\n${(p.text ?? "").trim()}`;
    });
  } catch (e) {
    console.warn("[project-qa] RAG retrieval failed — answering from structured context only:", e);
  }

  const hasAny =
    sessions.length > 0 || chatLines.length > 0 || files.length > 0 || retrieved.length > 0;
  if (!hasAny) {
    return finish(
      "I don't see any past sessions, chat, or files for this project yet — there's nothing to look up. Ask the customer for context once they've explained their situation.",
      "heuristic-fallback",
      "no_context",
    );
  }

  // ── Call OpenAI ──────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[project-qa] OPENAI_API_KEY missing — returning fallback");
    return finish(
      "AI assistant is offline (no OpenAI key configured). The project context is loaded — ask the customer directly for the specific detail you need.",
      "heuristic-fallback",
      "no_key",
    );
  }

  const system = buildSystemPrompt({ projectName, sessions, chatLines, files, retrieved });

  const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...((body.history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    })) as { role: "user" | "assistant"; content: string }[]),
    { role: "user", content: question },
  ];

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: openaiMessages,
        // Slightly lower temperature than the customer assistant — we
        // want accurate recall here, not creative riffing.
        temperature: 0.4,
        max_tokens: 500,
      }),
    });
    if (!r.ok) {
      console.warn(`[project-qa] OpenAI ${r.status}`);
      return finish(
        "Couldn't reach the AI service. The project context is loaded above — refer to the chat history while we get this working again.",
        "heuristic-fallback",
        "openai_error",
      );
    }
    const json = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return finish("AI returned an empty response. Try rephrasing the question.", "heuristic-fallback", "openai_error");
    }
    return finish(text, json.model ?? "openai");
  } catch (e) {
    console.warn("[project-qa] OpenAI fetch error", e);
    return finish("Network error reaching the AI service. Try again in a moment.", "heuristic-fallback", "openai_error");
  }
}
