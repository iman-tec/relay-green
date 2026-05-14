// Periodic session-health scorer (Groq-backed).
//
// Triggered by pg_cron once per minute (see scripts/schedule-health-cron.sql).
// For every session currently in {live, grace}, pull the last 60s of chat
// messages, ask Groq's Llama 3.1 8B Instant for a JSON {score, summary},
// and insert one row into session_health.
//
// Idempotency: not strictly needed — multiple invocations within the same
// minute just produce more rows, and the supervisor card reads the
// LATEST row (DISTINCT ON via latest_session_health view). Worst case:
// extra Groq calls on retries.
//
// Cost guardrail: only scores sessions with status IN (live, grace) and
// session age >= 60s. Queued / expired_free sessions don't have meaningful
// chat to evaluate; they're served by the deterministic verdict in the UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_API_KEY              = Deno.env.get("GROQ_API_KEY") ?? "";
// 8B Instant is fast (~500 tok/s) and free-tier-friendly. Bump to
// llama-3.3-70b-versatile if you start seeing mis-scored nuance.
const GROQ_MODEL                = Deno.env.get("GROQ_MODEL") ?? "llama-3.1-8b-instant";

const ACTIVE_FOR_SCORING = ["live", "grace"];
const WINDOW_SECONDS     = 60;

const SYSTEM_PROMPT = `You are an observability assistant for a real-time engineering support platform.

You receive a transcript window of chat messages between a customer and a Relay engineer during a live support session. Score the OVERALL HEALTH of the session on a continuous scale:

  -1.0  →  very poor (customer frustrated, hostile tone, engineer stuck, no progress, conflict)
   0.0  →  neutral/steady (no clear signal, normal back-and-forth, early-stage)
  +1.0  →  healthy (clear progress, problem being resolved, customer thanking, engineer guiding well)

Output STRICT JSON only — no prose before/after, no markdown fences:
{
  "score":   <number from -1.0 to 1.0, two-decimal precision>,
  "summary": "<one short sentence, MAX 80 characters, describing the state>"
}

Examples of negative indicators: repeated questions, frustration, expletives, dead silence when activity expected, engineer asking customer for help, customer asking for refunds.
Examples of positive indicators: solution being implemented, customer says "thanks/got it/great", clear next steps stated, code/config working.
If transcript is empty or trivial: score 0.0 and summary "Quiet — no signal yet."

JSON only. No other output.`;

type SessionRow = {
  id: string;
  status: string;
  joined_at: string | null;
  created_at: string;
  agent_name: string | null;
};

type MessageRow = {
  sender_kind: string;
  body: string;
  created_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Pull active sessions.
    const { data: sessions, error: sErr } = await admin
      .from("guest_calls")
      .select("id, status, joined_at, created_at, agent_name")
      .in("status", ACTIVE_FOR_SCORING);
    if (sErr) throw sErr;
    const list = (sessions ?? []) as SessionRow[];

    if (list.length === 0) {
      return new Response(JSON.stringify({ scored: 0, sessions: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const windowEnd   = new Date();
    const windowStart = new Date(windowEnd.getTime() - WINDOW_SECONDS * 1000);

    let scored = 0;
    const errors: { session_id: string; error: string }[] = [];

    // 2. Score sessions in parallel (each is one Groq call).
    //    Promise.allSettled so one bad session doesn't kill the whole tick.
    const results = await Promise.allSettled(
      list.map(async (s) => {
        // Skip newborn sessions — let them produce a couple of messages
        // before asking the LLM to read tea leaves.
        if (s.joined_at) {
          const age = windowEnd.getTime() - new Date(s.joined_at).getTime();
          if (age < WINDOW_SECONDS * 1000) return { session_id: s.id, skipped: "too_young" };
        }

        const { data: msgs } = await admin
          .from("guest_messages")
          // Only count human-typed chat as "signal" — system messages
          // ("Engineer joined", "Call started") are noise and shouldn't
          // trigger a Groq call.
          .select("sender_kind, body, created_at")
          .eq("guest_call_id", s.id)
          .gte("created_at", windowStart.toISOString())
          .order("created_at", { ascending: true });
        const allRows = (msgs ?? []) as MessageRow[];
        const messages = allRows.filter((m) => m.sender_kind === "guest" || m.sender_kind === "engineer");

        // SKIP empty-chat sessions entirely. The whole conversation
        // happens on Zoom (voice); we have nothing to score. Calling
        // Groq with an empty transcript just produces a flat
        // score=0 / "Quiet — no signal yet." row that misleads the
        // supervisor card into AMBER. Better to insert nothing — the
        // frontend's deriveHealth will fall back to the deterministic
        // verdict, which is accurate when there's no text signal.
        if (messages.length === 0) {
          return { session_id: s.id, skipped: "no_chat" };
        }

        const transcript = messages.map((m) => {
          const who =
            m.sender_kind === "guest"    ? "Customer" :
            m.sender_kind === "engineer" ? "Engineer" :
            m.sender_kind;
          return `${who}: ${m.body}`;
        }).join("\n");

        const userPrompt =
          `Session: ${s.id}\n` +
          `Status: ${s.status}\n` +
          `Engineer: ${s.agent_name ?? "unassigned"}\n` +
          `Transcript window: last ${WINDOW_SECONDS}s\n` +
          `---\n${transcript}`;

        // Call Groq.
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user",   content: userPrompt },
            ],
            temperature: 0,
            response_format: { type: "json_object" },
            max_tokens: 200,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`groq ${res.status}: ${txt.slice(0, 200)}`);
        }
        const groqRes = await res.json() as {
          choices?: { message?: { content?: string } }[];
        };
        const content = groqRes.choices?.[0]?.message?.content ?? "";
        let parsed: { score?: unknown; summary?: unknown };
        try {
          parsed = JSON.parse(content);
        } catch {
          throw new Error(`groq returned non-JSON: ${content.slice(0, 120)}`);
        }
        const rawScore = Number(parsed.score);
        const score = Number.isFinite(rawScore)
          ? Math.max(-1, Math.min(1, rawScore))
          : 0;
        const summary = String(parsed.summary ?? "").slice(0, 80) || "No summary.";

        const { error: insErr } = await admin.from("session_health").insert({
          session_id:    s.id,
          score,
          summary,
          window_start:  windowStart.toISOString(),
          window_end:    windowEnd.toISOString(),
          message_count: messages.length,
        });
        if (insErr) throw new Error(`insert: ${insErr.message}`);

        return { session_id: s.id, score, summary };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (!("skipped" in r.value)) scored++;
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push({ session_id: "?", error: reason });
        console.warn(`[score-session-health] ${reason}`);
      }
    }

    return new Response(JSON.stringify({
      sessions: list.length,
      scored,
      skipped: list.length - scored - errors.length,
      errors,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[score-session-health]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
