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

export const runtime = "nodejs";

interface RequestBody {
  projectId?: string;
  question?: string;
  history?: { role: "user" | "assistant"; content: string }[];
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
}): string {
  const parts: string[] = [
    "You are Relay's project-context assistant for engineers.",
    "An engineer is supporting a customer right now (likely on a Zoom call in another window) and needs to recall project context quickly.",
    "Answer crisply. If the answer isn't in the context, say so honestly — never invent details.",
    "Prefer 1-3 sentences. If the question is open-ended (e.g. 'tell me about this project'), give a short bullet summary instead.",
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

  // 3. Chat transcript across those sessions.
  type ChatRow = {
    sender_kind: string;
    sender_name: string | null;
    body: string | null;
    created_at: string;
  };
  let chatLines: string[] = [];
  if (sessionIds.length > 0) {
    const { data: chatRows } = await sb
      .from("guest_messages")
      .select("sender_kind, sender_name, body, created_at")
      .in("guest_call_id", sessionIds)
      .order("created_at", { ascending: true })
      .limit(MAX_CHAT_LINES);
    chatLines = ((chatRows ?? []) as ChatRow[])
      .filter((m) => m.body && m.body.trim().length > 0)
      .map((m) => {
        const who = m.sender_name ?? m.sender_kind;
        const date = new Date(m.created_at).toISOString().split("T")[0];
        return `[${date}] ${who}: ${(m.body ?? "").trim().slice(0, 600)}`;
      });
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

  const hasAny = sessions.length > 0 || chatLines.length > 0 || files.length > 0;
  if (!hasAny) {
    return NextResponse.json({
      text: "I don't see any past sessions, chat, or files for this project yet — there's nothing to look up. Ask the customer for context once they've explained their situation.",
      model: "heuristic-fallback",
      fallback: "no_context",
    });
  }

  // ── Call OpenAI ──────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[project-qa] OPENAI_API_KEY missing — returning fallback");
    return NextResponse.json({
      text: "AI assistant is offline (no OpenAI key configured). The project context is loaded — ask the customer directly for the specific detail you need.",
      model: "heuristic-fallback",
      fallback: "no_key",
    });
  }

  const system = buildSystemPrompt({ projectName, sessions, chatLines, files });

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
      return NextResponse.json({
        text: "Couldn't reach the AI service. The project context is loaded above — refer to the chat history while we get this working again.",
        model: "heuristic-fallback",
        fallback: "openai_error",
      });
    }
    const json = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return NextResponse.json({
        text: "AI returned an empty response. Try rephrasing the question.",
        model: "heuristic-fallback",
        fallback: "openai_error",
      });
    }
    return NextResponse.json({ text, model: json.model ?? "openai" });
  } catch (e) {
    console.warn("[project-qa] OpenAI fetch error", e);
    return NextResponse.json({
      text: "Network error reaching the AI service. Try again in a moment.",
      model: "heuristic-fallback",
      fallback: "openai_error",
    });
  }
}
