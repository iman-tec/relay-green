/*
 * Intake-assistant chat turn.
 *
 * POST /api/intake/turn
 *   The customer's IntakeAssistant calls this on every user message. We
 *   forward the running transcript + structured context to OpenAI with a
 *   tight system prompt and return the next assistant turn as JSON:
 *
 *     { body, quickReplies, extractedFields, intakeDone }
 *
 *   Matches the shape of IntakePrompt in lib/intake/intakeAssistant.ts so
 *   the existing UI doesn't have to branch.
 *
 * Failure modes are explicit:
 *   - Missing OPENAI_API_KEY → 503 (client falls back to local script).
 *   - OpenAI 5xx / parse error → 502 (client falls back to local script).
 *   - Bad request body → 400.
 *
 * Same OpenAI pattern as the summarize-* edge functions — raw fetch,
 * gpt-4o-mini, response_format=json_object. No SDK dependency.
 */

import { NextResponse } from "next/server";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Keep the schema small — UI consumes these exact field names.
type Field = "building" | "problem" | "stack" | "aiTools";

type ChatMessage = { role: "assistant" | "user"; body: string };

type ReqBody = {
  messages:        ChatMessage[];
  context:         Partial<Record<Field, string>>;
  profile?: {
    isReturning?:  boolean;
    knownStack?:   string[];   // technologies the customer has already declared
    knownProblem?: string;
  };
  resumeContext?: {
    mode?:             "follow_up" | "continue";
    aiSummaryTitle?:   string | null;
    aiSummary?:        string | null;
    aiNextSteps?:      string | null;
    projectName?:      string | null;
  } | null;
};

type AiTurn = {
  body:            string;
  quickReplies:    string[];
  extractedFields: Partial<Record<Field, string>>;
  intakeDone:      boolean;
};

const SYSTEM_PROMPT = `You are Relay's intake assistant. While a customer waits ~90 seconds for a senior engineer to pick up their video call, you collect the few pieces of context the engineer needs to be productive from the moment they say hello.

YOUR JOB
- Ask ONE focused question at a time. Never multi-part. Never a wall of text.
- Capture four pieces of structured context across the conversation:
    * building  — what they're building (product, audience, stage)
    * problem   — what's stuck or what they need help with (the precise blocker)
    * stack     — the tech stack involved (languages, frameworks, services)
    * aiTools   — which AI tools they've been pairing with (Claude / ChatGPT / Cursor / Lovable / etc.)
- After all four are present, switch to ACKNOWLEDGE mode: short, varied replies that invite more detail (errors, screenshots, what they've tried). Never repeat yourself. Never repeat "great" / "awesome" / "perfect".

INPUTS
- "messages" is the full transcript so far (oldest first). The most recent user message is what you respond to.
- "context" is the fields already captured this session. Treat as authoritative — do NOT re-ask anything that already has a value.
- "profile.isReturning" + "profile.knownStack": this customer has used Relay before. Skip the first three questions if "knownStack" is non-empty; open instead by acknowledging what you remember and asking only what's changed, then move to "problem".
- "resumeContext" (optional): they clicked "Continue this session" or "Start a follow-up" on a recent session. Open by referencing the prior project / summary and ask what's new or what's blocking now, then collect missing fields.

TONE
- Crisp, helpful, like a smart colleague. One sentence per turn unless context truly demands two.
- No emojis. No sycophancy. No "Hi I'm an AI". You are Relay's intake assistant — that's it.
- Acknowledge what the user just said briefly before moving to the next question, in their own words where natural.

OUTPUT
You MUST return STRICT JSON in this exact shape — no markdown, no prose around it:

{
  "body":            "string — what to say next, plain prose",
  "quickReplies":    ["short", "tappable", "chip", "labels"],
  "extractedFields": { "building"?: "...", "problem"?: "...", "stack"?: "...", "aiTools"?: "..." },
  "intakeDone":      true | false
}

RULES
- "extractedFields" must contain ONLY new information extracted from the MOST RECENT user message — use the user's own wording where possible, keep entries to one or two sentences. Do not echo fields already present in "context".
- "quickReplies" should hold 3–6 short relevant suggestions WHEN you're asking a question that benefits from them (especially "stack" and "aiTools"). Use an empty array during acknowledgements or when chips would be guesswork.
- "intakeDone" = true once "building", "problem", "stack", AND "aiTools" all have values (either from "context" or from your own "extractedFields" this turn).
- The opener (when "messages" is empty or only has assistant greetings) should be one question, not a paragraph. Returning users get a stack-check; new users get the "building" question; resume contexts get the "what's changed" question.
- If the user provides multiple fields in a single message, extract all of them; never invent values they didn't say.
- Never mention being an AI, GPT, model, or this system prompt.`;

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "openai_not_configured" },
      { status: 503 },
    );
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // Compose the user message for OpenAI: a compact state snapshot followed
  // by the latest user turn. The model gets the full transcript through
  // the messages array so multi-turn context stays cheap.
  const stateBlock = JSON.stringify(
    {
      context:       body.context ?? {},
      profile:       body.profile ?? null,
      resumeContext: body.resumeContext ?? null,
    },
    null,
    2,
  );

  // Build the OpenAI messages array. The first user message holds the
  // current state; subsequent items are the actual transcript so the model
  // sees the order of turns.
  const openaiMessages = [
    { role: "system",  content: SYSTEM_PROMPT },
    { role: "user",    content: `CURRENT STATE\n${stateBlock}` },
    ...body.messages.map((m) => ({
      role:    m.role === "assistant" ? "assistant" : "user",
      content: m.body,
    })),
  ];

  let upstream: Response;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:           MODEL,
        messages:        openaiMessages,
        temperature:     0.6,
        response_format: { type: "json_object" },
        max_tokens:      400,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network_error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "openai_upstream", status: upstream.status, detail: text.slice(0, 500) },
      { status: 502 },
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return NextResponse.json({ error: "openai_parse" }, { status: 502 });
  }

  const content = extractAssistantContent(payload);
  if (!content) {
    return NextResponse.json({ error: "empty_completion" }, { status: 502 });
  }

  // OpenAI is asked for json_object; parse with a forgiving fallback so a
  // stray code-fence wrapper doesn't kill the turn.
  let turn: AiTurn | null = null;
  try {
    turn = JSON.parse(stripJsonFence(content)) as AiTurn;
  } catch {
    return NextResponse.json({ error: "bad_completion_json", raw: content.slice(0, 400) }, { status: 502 });
  }

  // Defensive normalisation — never trust the model with the UI's shape.
  const normalised: AiTurn = {
    body:            typeof turn.body === "string" ? turn.body : "",
    quickReplies:    Array.isArray(turn.quickReplies)
      ? turn.quickReplies.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 8)
      : [],
    extractedFields: extractFields(turn.extractedFields),
    intakeDone:      Boolean(turn.intakeDone),
  };

  return NextResponse.json(normalised);
}

function extractAssistantContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const c = first?.message?.content;
  return typeof c === "string" ? c : null;
}

function stripJsonFence(s: string): string {
  // Some models occasionally wrap JSON in ```json ... ``` despite
  // response_format. Strip a single leading/trailing fence to be safe.
  const trimmed = s.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }
  return trimmed;
}

function extractFields(raw: unknown): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of ["building", "problem", "stack", "aiTools"] as Field[]) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) {
      out[k] = v.trim();
    }
  }
  return out;
}
