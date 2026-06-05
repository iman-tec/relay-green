// Periodic session-sentiment scorer (OpenAI-backed).
//
// Triggered by pg_cron once per minute (see scripts/schedule-health-cron.sql).
// For every active session, pull the ENTIRE conversation so far — every chat
// message (guest_messages) AND the full spoken transcript (session_captions,
// Zoom live transcription) from the moment the call started — merge them into
// one chronological transcript, and ask OpenAI for a COLLECTIVE reading:
//
//   { score: -1.0..1.0, activeness: 0.0..1.0, summary: "<one line>" }
//
// Each tick writes:
//   • sup_sentiment (phase='live')  — the new supervisor-facing table whose
//     `state` column derives orange/red thresholds in the DB
//     (score < -0.3 red · < 0.3 orange · else green)
//   • session_health                — legacy row kept for the roster /
//     act-now / finance / feedback consumers until they migrate.
//
// Scoring is CUMULATIVE, not windowed: the model sees everything since the
// session began (bounded by a char budget that keeps the newest lines), with
// the last 2 minutes marked so it weighs the current state most. Idempotency
// isn't required — multiple ticks in a minute just add rows; readers take the
// latest via latest_sup_sentiment / latest_session_health.
//
// Cost guardrails: only sessions in an active status, and sessions with zero
// signal (no chat AND no captions) are skipped before any model call.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_SENTIMENT_MODEL") ?? "gpt-4o-mini";

// Includes assigned/joining, not just live/grace: the status machine only
// flips to "live" when a participant triggers mark_joined, but chat (and
// even a call) can be fully underway before anyone clicks the in-app Join
// button — a real session on 2026-06-03 ran its entire 3.6-minute life in
// pre-live status and was therefore invisible to the sentiment bar. The
// no-signal skip below keeps silent assigned sessions from costing tokens.
const ACTIVE_FOR_SCORING = ["assigned", "joining", "live", "grace"];

// Newborn grace: let a session accumulate ~1 minute of signal first.
const MIN_AGE_MS = 60_000;

// Cumulative transcript char budget. ~24k chars ≈ 6k tokens — comfortably
// inside gpt-4o-mini's window at minute-tick frequency. When over budget we
// keep the NEWEST lines (the model is told the transcript may be truncated
// at the start).
const TRANSCRIPT_CHAR_BUDGET = 24_000;

const SYSTEM_PROMPT = `You are the live session-monitor for Relay, a real-time engineering support platform where a customer and a Relay engineer work together over text chat and a video call.

You receive the FULL conversation of one session so far (it may be truncated at the START if very long). It interleaves TWO channels in chronological order, each line tagged with its source:
  • "(chat)"  — typed chat messages
  • "(voice)" — the spoken call transcript (Zoom live transcription)
Lines after the marker "── LAST 2 MINUTES ──" are the most recent activity.

Evaluate the session COLLECTIVELY across BOTH channels — call sentiment and chat sentiment together, as one conversation. A frustrated voice call with polite chat is still unhealthy; a quiet call with productive chat is still healthy. Weigh the whole history, but the CURRENT state (the last few minutes) matters most: a session that started rough and is now resolving should score above one that started fine and is degrading.

Return STRICT JSON only — no prose, no markdown fences:
{
  "score":      <number, -1.0 to 1.0, two decimals>,
  "activeness": <number, 0.0 to 1.0, two decimals>,
  "summary":    "<one sentence, MAX 120 characters, present tense, describing the current state>"
}

score — overall session health/sentiment:
  +1.0  excellent — clear progress, problem resolved/resolving, customer expressing satisfaction
  +0.4  good — solution under way, cooperative tone, no friction
   0.0  neutral — informational back-and-forth, early stage, or genuinely ambiguous
  -0.4  poor — customer mildly frustrated, progress stalled, repeated questions
  -1.0  critical — customer angry/hostile, demanding refund/escalation, engineer stuck, conflict
Negative indicators: repeated unanswered questions, frustration or expletives, long silence where activity is expected, customer asking for refunds or escalation, engineer unable to make progress.
Positive indicators: fixes being implemented and confirmed working, "thanks / got it / great", clear next steps, customer relaxed.

activeness — engagement level across both channels, independent of polarity:
  1.0  both sides actively conversing right now (voice flowing and/or rapid chat)
  0.5  intermittent activity — slow but alive
  0.0  dead air — no chat and no speech recently despite the session being open
Judge mostly from the LAST 2 MINUTES section; the history only calibrates what "normal" looks like for this session.

If the transcript is empty or trivial: score 0.0, activeness 0.0, summary "Quiet — no signal yet."
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
  sender_name: string | null;
  body: string | null;
  created_at: string;
};

type CaptionRow = {
  speaker: string | null;
  text: string;
  window_end: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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

    const now = new Date();
    let scored = 0;
    const errors: { session_id: string; error: string }[] = [];

    // 2. Score sessions in parallel (one OpenAI call each).
    //    Promise.allSettled so one bad session doesn't kill the whole tick.
    const results = await Promise.allSettled(
      list.map(async (s) => {
        const anchor = s.joined_at ?? s.created_at;
        if (now.getTime() - new Date(anchor).getTime() < MIN_AGE_MS) {
          return { session_id: s.id, skipped: "too_young" };
        }

        // Pull the ENTIRE conversation so far — both channels in parallel.
        const [msgsRes, capsRes] = await Promise.all([
          admin
            .from("guest_messages")
            .select("sender_kind, sender_name, body, created_at")
            .eq("guest_call_id", s.id)
            .order("created_at", { ascending: true }),
          admin
            .from("session_captions")
            .select("speaker, text, window_end")
            .eq("session_id", s.id)
            .order("window_end", { ascending: true }),
        ]);
        const allMsgs = ((msgsRes.data ?? []) as MessageRow[]).filter(
          (m) =>
            (m.sender_kind === "guest" || m.sender_kind === "engineer") &&
            typeof m.body === "string" &&
            m.body.trim().length > 0
        );
        const captions = (capsRes.data ?? []) as CaptionRow[];

        // SKIP only when BOTH signal sources are empty — silent sessions
        // cost nothing.
        if (allMsgs.length === 0 && captions.length === 0) {
          return { session_id: s.id, skipped: "no_signal" };
        }

        // Build ONE chronological transcript across both channels, with a
        // recency marker so the model can weigh the current state.
        type Line = { ts: number; line: string };
        const lines: Line[] = [];
        for (const m of allMsgs) {
          const who =
            m.sender_kind === "guest"
              ? (m.sender_name ?? "Customer")
              : (m.sender_name ?? "Engineer");
          lines.push({
            ts: new Date(m.created_at).getTime(),
            line: `${who} (chat): ${(m.body ?? "").trim()}`,
          });
        }
        for (const c of captions) {
          const t = (c.text ?? "").trim();
          if (!t) continue;
          lines.push({
            ts: new Date(c.window_end).getTime(),
            line: `${c.speaker ?? "Speaker"} (voice): ${t}`,
          });
        }
        lines.sort((a, b) => a.ts - b.ts);

        const twoMinAgo = now.getTime() - 2 * 60_000;
        const older = lines.filter((l) => l.ts < twoMinAgo).map((l) => l.line);
        const recent = lines
          .filter((l) => l.ts >= twoMinAgo)
          .map((l) => l.line);
        let transcript = [
          ...older,
          "── LAST 2 MINUTES ──",
          ...(recent.length > 0
            ? recent
            : ["(no activity in the last 2 minutes)"]),
        ].join("\n");
        // Over budget → keep the newest chars (the prompt says the start may
        // be truncated).
        if (transcript.length > TRANSCRIPT_CHAR_BUDGET) {
          transcript =
            "…(transcript truncated)…\n" +
            transcript.slice(-TRANSCRIPT_CHAR_BUDGET);
        }

        const startedAt = s.joined_at ?? s.created_at;
        const ageMin = Math.round(
          (now.getTime() - new Date(startedAt).getTime()) / 60_000
        );
        const userPrompt =
          `Session: ${s.id}\n` +
          `Status: ${s.status}\n` +
          `Engineer: ${s.agent_name ?? "unassigned"}\n` +
          `Session age: ~${ageMin} min\n` +
          `Signals so far: ${allMsgs.length} chat line(s), ${captions.length} voice caption window(s)\n` +
          `---\n${transcript}`;

        // 3. OpenAI call.
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            temperature: 0,
            response_format: { type: "json_object" },
            max_tokens: 200,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`openai ${res.status}: ${txt.slice(0, 200)}`);
        }
        const aiRes = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = aiRes.choices?.[0]?.message?.content ?? "";
        let parsed: {
          score?: unknown;
          activeness?: unknown;
          summary?: unknown;
        };
        try {
          parsed = JSON.parse(content);
        } catch {
          throw new Error(`openai returned non-JSON: ${content.slice(0, 120)}`);
        }
        const rawScore = Number(parsed.score);
        const score = Number.isFinite(rawScore)
          ? Math.max(-1, Math.min(1, rawScore))
          : 0;
        const rawAct = Number(parsed.activeness);
        const activeness = Number.isFinite(rawAct)
          ? Math.max(0, Math.min(1, rawAct))
          : null;
        const summary =
          String(parsed.summary ?? "").slice(0, 160) || "No summary.";

        // 4. Persist — new supervisor table + legacy row in parallel.
        const windowStart = new Date(now.getTime() - 60_000);
        const [supIns, legacyIns] = await Promise.all([
          admin.from("sup_sentiment").insert({
            session_id: s.id,
            score,
            summary,
            activeness,
            phase: "live",
            chat_count: allMsgs.length,
            caption_count: captions.length,
          }),
          // Legacy session_health row keeps the roster / act-now / finance /
          // feedback consumers alive until they migrate to sup_sentiment.
          admin.from("session_health").insert({
            session_id: s.id,
            score,
            summary: summary.slice(0, 80),
            window_start: windowStart.toISOString(),
            window_end: now.toISOString(),
            message_count: allMsgs.length + captions.length,
          }),
        ]);
        if (supIns.error)
          throw new Error(`sup_sentiment insert: ${supIns.error.message}`);
        if (legacyIns.error) {
          // Non-fatal — the new table is the source of truth going forward.
          console.warn(
            `[score-session-health] legacy insert failed: ${legacyIns.error.message}`
          );
        }

        return { session_id: s.id, score, activeness, summary };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (!("skipped" in r.value)) scored++;
      } else {
        const reason =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
        errors.push({ session_id: "?", error: reason });
        console.warn(`[score-session-health] ${reason}`);
      }
    }

    return new Response(
      JSON.stringify({
        sessions: list.length,
        scored,
        skipped: list.length - scored - errors.length,
        errors,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[score-session-health]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
