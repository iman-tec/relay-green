/*
 * POST /api/assistant
 *
 * Server-side OpenAI proxy. Used by the in-room chat (RoomClient AsyncChatPane
 * + IntakeAssistant) for context-aware bot greetings, resume prompts, and
 * follow-up questions. The API key NEVER reaches the client.
 *
 * Body (JSON):
 *   {
 *     mode: "greeting" | "resume" | "chat",
 *     profile?: { techComfort, stack, urgency },
 *     funnel?:  { need, stack, urgency },
 *     resume?:  { projectName, aiSummaryTitle, aiSummary, aiNextSteps },
 *     messages?: { role: "user"|"assistant", content: string }[],
 *   }
 *
 * Response:
 *   { text: string, model: string, fallback?: "no_key"|"openai_error" }
 *
 * Graceful fallback: if OPENAI_API_KEY is missing or the OpenAI call fails,
 * we return a heuristic prompt so the chat never crashes. The fallback flag
 * lets the client log a warning without disrupting UX.
 */

import { NextResponse, type NextRequest } from "next/server";

type AssistantMode = "greeting" | "resume" | "chat";

interface Stack {
  aiTools?: string[];
  backend?: string[];
  frontend?: string[];
}

interface AssistantBody {
  mode?: AssistantMode;
  profile?: {
    techComfort?: string | null;
    stack?: Stack;
    urgency?: string | null;
  };
  funnel?: {
    need?: string | null;
    stack?: Stack;
    urgency?: string | null;
  };
  resume?: {
    projectName?: string | null;
    aiSummaryTitle?: string | null;
    aiSummary?: string | null;
    aiNextSteps?: string[] | null;
  };
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
}

const FALLBACK_GREETINGS: Record<AssistantMode, string> = {
  greeting:
    "Hi — I'm Relay's intake helper. Describe what you're stuck on and I'll line up context for your engineer while we connect you.",
  resume:
    "Welcome back — picking up where you left off. What's changed since last time?",
  chat: "Got it. Anything else your engineer should know before they pick up?",
};

function flattenStack(s?: Stack): string[] {
  if (!s) return [];
  return [...(s.aiTools ?? []), ...(s.backend ?? []), ...(s.frontend ?? [])];
}

function buildSystemPrompt(body: AssistantBody): string {
  const lines: string[] = [
    "You are Relay's intake assistant. Relay matches builders with real engineers in under 90 seconds.",
    "Speak warmly and concisely. Never invent product details. Keep replies under 3 sentences.",
  ];
  const stack = flattenStack(body.profile?.stack).concat(
    flattenStack(body.funnel?.stack),
  );
  if (stack.length) {
    lines.push(`Customer stack: ${Array.from(new Set(stack)).slice(0, 10).join(", ")}.`);
  }
  if (body.funnel?.need) lines.push(`Customer need: ${body.funnel.need}.`);
  if (body.funnel?.urgency) lines.push(`Urgency: ${body.funnel.urgency}.`);
  if (body.profile?.techComfort)
    lines.push(`Technical comfort: ${body.profile.techComfort}.`);
  if (body.resume?.aiSummaryTitle)
    lines.push(`Last session: ${body.resume.aiSummaryTitle}.`);
  if (body.resume?.aiSummary)
    lines.push(`Prior summary: ${body.resume.aiSummary}`);
  if (body.resume?.aiNextSteps?.length)
    lines.push(`Pending next steps: ${body.resume.aiNextSteps.join("; ")}.`);
  return lines.join(" ");
}

function fallback(body: AssistantBody, reason: "no_key" | "openai_error") {
  const mode: AssistantMode = body.mode ?? "greeting";
  const text = FALLBACK_GREETINGS[mode];
  return NextResponse.json(
    { text, model: "heuristic-fallback", fallback: reason },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  let body: AssistantBody = {};
  try {
    body = (await req.json()) as AssistantBody;
  } catch {
    body = {};
  }
  const mode: AssistantMode = body.mode ?? "greeting";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[assistant] OPENAI_API_KEY missing — returning fallback");
    return fallback(body, "no_key");
  }

  const system = buildSystemPrompt(body);
  const userInstruction =
    mode === "greeting"
      ? "Write a warm 1-2 sentence first-time greeting that invites the customer to describe what they're stuck on. Reference their stack if known. Do not say 'welcome back' — this is their first session."
      : mode === "resume"
        ? "Write a 1-2 sentence 'welcome back' that references the prior session title and asks what's changed."
        : "Reply naturally to continue the conversation in 1-3 sentences.";

  const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...((body.messages ?? []).map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    })) as { role: "system" | "user" | "assistant"; content: string }[]),
    { role: "user", content: userInstruction },
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
        temperature: 0.7,
        max_tokens: 180,
      }),
    });
    if (!r.ok) {
      console.warn(`[assistant] OpenAI ${r.status} — returning fallback`);
      return fallback(body, "openai_error");
    }
    const json = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return fallback(body, "openai_error");
    }
    return NextResponse.json({ text, model: json.model ?? "openai" }, { status: 200 });
  } catch (e) {
    console.warn("[assistant] OpenAI fetch error", e);
    return fallback(body, "openai_error");
  }
}
