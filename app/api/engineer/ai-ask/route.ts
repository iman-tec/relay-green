/*
 * POST /api/engineer/ai-ask
 *
 * Streaming endpoint that powers the EngineerAiAsk bar in the engineer
 * live session room. Body: { sessionId, question }.
 *
 * Flow:
 *   1. JWT auth via @/lib/supabase/server (cookie-bound). 401 if absent.
 *   2. Fetch the session row + verify the caller is claimed_by (or holds
 *      a supervisor role). 403 / 404 otherwise.
 *   3. Resolve project_id from the session. If null, short-circuit with
 *      a friendly stock answer — no LLM call.
 *   4. Insert a placeholder engineer_ai_queries row (question only).
 *      Captures the row id so the streaming onFinish callback can fill
 *      answer + citations.
 *   5. Assemble project context via lib/relay/engineerAiContext.ts using
 *      a service-role client (cross-RLS reads after auth is already
 *      verified above).
 *   6. Stream from OpenAI gpt-4o via Vercel AI SDK streamText. onFinish
 *      writes answer + citations + answer_completed_at back to the row.
 *
 * Returns: a text-stream response consumable by AI SDK useChat /
 * useCompletion on the client.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { createClient } from "@/lib/supabase/server";
import {
  assembleProjectContext,
  type Citation,
} from "@/lib/relay/engineerAiContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_ID = "gpt-4o";

const SYSTEM_PROMPT = `You are an AI assistant for a Relay engineer who is currently on a live call with a customer. Your job is to help them recall context from this customer's past sessions on this project so they can support the customer faster.

Rules:
- Be concise. The engineer is on a live call — terse answers > prose. Aim for 1-4 short sentences unless the engineer explicitly asks for detail.
- Only use information from the project context provided below. If the answer isn't there, say so plainly ("I don't see that in past sessions").
- If a "Customer's pre-call note" block is present, that's the customer's own framing of what they need help with on THIS call — treat it as the most authoritative signal of their current goal/blocker and lead with it when the engineer asks what the customer wants.
- When you reference a past session, cite it by its [S#] token (or [I] for the intake brief, [F#] for a file). The UI maps these back to clickable session links.
- Don't fabricate file contents — you only have file names, not bodies. If the engineer asks "what's in schema.sql", say "I can see schema.sql was shared in [S1] but I can't read its contents — open the session review."
- Never expose the customer's email or other PII in the answer.
- If the engineer's question isn't about this customer's project at all (e.g. they ask "what's the weather"), gently redirect: "I only have context for this customer's project — try asking about past sessions or what they've worked on."`;

type ReqBody = {
  sessionId?: string;
  question?: string;
  // AI SDK useChat sends a `messages` array — we accept either shape so
  // the route works whether the client uses useChat or a plain fetch.
  messages?: Array<{ role: string; content: string }>;
};

export async function POST(req: NextRequest) {
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Question: support both useChat (last user message) and the direct
  // { question } shape.
  const question =
    (body.question ?? "").trim() ||
    (
      (body.messages ?? []).filter((m) => m.role === "user").pop()?.content ??
      ""
    ).trim();
  const sessionId = (body.sessionId ?? "").trim();

  if (!question) {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // ── 1. Auth ─────────────────────────────────────────────────────────
  const sbUser = await createClient();
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = userRes.user.id;

  // ── 2. Session + claim authorization ────────────────────────────────
  const { data: sessionRow, error: sessionErr } = await sbUser
    .from("guest_calls")
    .select("id, project_id, customer_user_id, claimed_by")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }
  if (!sessionRow) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Author-check: caller must be claimed_by on this session, OR hold a
  // supervisor-tier role. Mirrors the engineer_has_project_access SQL
  // helper used by the engineer_ai_queries RLS policies, but at the
  // application layer so we can return a friendly 403 instead of a
  // silent empty-row insert.
  let authorized = sessionRow.claimed_by === userId;
  if (!authorized) {
    const { data: roleRows } = await sbUser
      .from("user_role_names")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    authorized = roles.some(
      (r) =>
        r === "supervisor" ||
        r === "super_admin" ||
        r === "enterprise_admin" ||
        r === "department_admin" ||
        r === "reseller"
    );
  }
  if (!authorized) {
    return NextResponse.json(
      { error: "You don't have access to this session's project." },
      { status: 403 }
    );
  }

  const projectId = sessionRow.project_id as string | null;

  // ── 3. Short-circuit when session has no project ────────────────────
  if (!projectId) {
    return new Response(
      "This session isn't linked to a project yet, so I don't have past-session context to draw from. Once a project is set, I can pull past summaries and files for you.",
      {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  // ── 4. Service-role client for cross-RLS reads + the placeholder
  // insert (RLS would block the insert if the engineer hadn't claimed
  // a session yet on this project; we've already auth'd them above).
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server is missing Supabase service credentials" },
      { status: 503 }
    );
  }
  const sbService = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Placeholder row — question now, answer fills in onFinish.
  const { data: insertRow, error: insertErr } = await sbService
    .from("engineer_ai_queries")
    .insert({
      project_id: projectId,
      session_id: sessionId,
      asked_by_user_id: userId,
      question,
      model: `openai/${MODEL_ID}`,
    })
    .select("id")
    .single();
  if (insertErr || !insertRow) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Couldn't log query." },
      { status: 500 }
    );
  }
  const queryId = (insertRow as { id: string }).id;

  // ── 5. Assemble context ─────────────────────────────────────────────
  let assembled: Awaited<ReturnType<typeof assembleProjectContext>>;
  try {
    assembled = await assembleProjectContext(sbService, {
      projectId,
      currentSessionId: sessionId,
    });
  } catch (e) {
    // Don't crash the route — surface a partial answer.
    const msg = e instanceof Error ? e.message : "Context assembly failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── 6. Check OpenAI key + stream ────────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing OPENAI_API_KEY" },
      { status: 503 }
    );
  }

  const citations: Citation[] = assembled.citations;
  const userMessage =
    `${assembled.contextBlob}\n\n` +
    `============================================================\n` +
    `Engineer's question: ${question}\n` +
    `============================================================`;

  const result = streamText({
    model: openai(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.2,
    onFinish: async ({ text }) => {
      // Filter citations to only those the model actually used, by
      // scanning the answer for [S#] / [F#] / [I] tokens. Reduces noise
      // in the UI chip row.
      const used = citations.filter((c) => {
        const tokenPattern = new RegExp(`\\[${escapeRegex(c.token)}\\]`);
        return tokenPattern.test(text);
      });
      await sbService
        .from("engineer_ai_queries")
        .update({
          answer: text,
          citations: used.length > 0 ? used : citations.slice(0, 0),
          answer_completed_at: new Date().toISOString(),
        })
        .eq("id", queryId);
    },
  });

  // toTextStreamResponse is the AI SDK helper that returns a streaming
  // Response compatible with `useChat` and `useCompletion` on the client.
  return result.toTextStreamResponse();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
