/*
 * summarize-call — CALL-ONLY summary, generated when a Zoom video call ends
 * (mid-session, WITHOUT ending the session).
 *
 * Distinct from `summarize-guest-call`:
 *   • summarize-guest-call = COLLECTIVE session summary (chat + call + sentiment),
 *     written to guest_calls.ai_summary_* and rendered as the EditableSummary
 *     panel. Runs once, at SESSION end, and flips status → ended.
 *   • summarize-call (this fn) = the per-call recap built ONLY from the spoken
 *     voice transcript (session_captions). Posted as a "Call summary" capsule
 *     system message so it appears inline in the customer's chat the moment the
 *     call ends, even though the session/chat keeps going. Does NOT touch
 *     status, ai_summary_*, or sentiment.
 *
 * The capsule body uses the "🤖 AI Companion summary" marker so the existing
 * MeetingSummaryEntry card (isAiSummaryMessageBody) renders it. Idempotent:
 * skips if an AI-summary system message already exists for the call, so re-runs
 * and the summarize-guest-call fallback never double-post.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    // Accept either key — zoom-video-sdk-end speaks session_id, the rest of
    // the summary pipeline speaks guest_call_id.
    const id: string | undefined = body.guest_call_id ?? body.session_id;
    if (!id) return json({ error: "guest_call_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotency: if a Call-summary capsule already exists for this call,
    // don't post another. (summarize-guest-call uses the same guard, so the
    // two never race to double-post.)
    const { data: existing } = await supabase
      .from("guest_messages")
      .select("id")
      .eq("guest_call_id", id)
      .eq("sender_kind", "system")
      .ilike("body", "%AI Companion summary%")
      .limit(1)
      .maybeSingle();
    if (existing) return json({ skipped: "already_exists" });

    const { data: call } = await supabase
      .from("guest_calls")
      .select("guest_name, video_started_at, video_ended_at")
      .eq("id", id)
      .maybeSingle();

    // The call summary covers what happened ON THIS CALL — which is the spoken
    // voice transcript PLUS the chat exchanged while the call was live. (When
    // nobody speaks, the whole call happens in chat, as in a typed support
    // session — so voice-only would leave the capsule empty.) We scope chat to
    // the video window [video_started_at, video_ended_at + 60s]; pre/post-call
    // chat belongs to the collective session summary, not this call.
    const startMs = call?.video_started_at
      ? new Date(call.video_started_at).getTime()
      : null;
    const endMs = call?.video_ended_at
      ? new Date(call.video_ended_at).getTime() + 60_000
      : null;

    const [capsRes, msgsRes] = await Promise.all([
      supabase
        .from("session_captions")
        .select("speaker, text, window_end")
        .eq("session_id", id)
        .order("window_end", { ascending: true }),
      supabase
        .from("guest_messages")
        .select("sender_kind, sender_name, body, created_at")
        .eq("guest_call_id", id)
        .neq("sender_kind", "system")
        .order("created_at", { ascending: true }),
    ]);
    const caps = (capsRes.data ?? []) as Array<{
      speaker: string | null;
      text: string;
      window_end: string;
    }>;
    const chat = (
      (msgsRes.data ?? []) as Array<{
        sender_kind: string;
        sender_name: string | null;
        body: string;
        created_at: string;
      }>
    )
      .filter((m) => typeof m.body === "string" && m.body.trim().length > 0)
      .filter((m) => {
        if (startMs == null) return true; // no window → take all human chat
        const t = new Date(m.created_at).getTime();
        return t >= startMs && (endMs == null || t <= endMs);
      });

    // Interleave voice + chat chronologically into one call transcript.
    const lines: Array<{ ts: number; text: string }> = [];
    for (const c of caps) {
      lines.push({
        ts: new Date(c.window_end).getTime(),
        text: `${c.speaker ?? "Speaker"} (voice): ${c.text}`,
      });
    }
    for (const m of chat) {
      lines.push({
        ts: new Date(m.created_at).getTime(),
        text: `${m.sender_name ?? m.sender_kind}: ${m.body}`,
      });
    }
    lines.sort((a, b) => a.ts - b.ts);
    const transcript = lines
      .map((l) => l.text)
      .join("\n")
      .trim();

    const totalChars =
      caps.reduce((n, c) => n + (c.text?.trim().length ?? 0), 0) +
      chat.reduce((n, m) => n + m.body.trim().length, 0);
    if (!transcript || totalChars < 30) {
      return json({ skipped: "nothing_to_summarize" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "openai_key_missing" }, 500);

    let aiTitle = "";
    let aiOverview = "";
    let aiNextSteps: string[] = [];
    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You summarize a single short engineer↔builder support call. " +
              "The transcript interleaves what was spoken (`Speaker (voice): text`) and the chat exchanged while the call was live (`Name: text`) — both are part of the same call. " +
              'Respond with strict JSON only: {"title": string, "overview": string, "next_steps": string[]}. ' +
              '`title`: 3-5 words, NO period, name the issue discussed (e.g. "Data migration issue"). ' +
              "`overview`: 2-3 sentence recap of what was covered on the call. " +
              "`next_steps`: up to 5 short imperative items agreed on the call (empty array if none). No prose outside the JSON.",
          },
          {
            role: "user",
            content: `Guest: ${call?.guest_name ?? "Builder"}\n\nCall transcript:\n${transcript}`,
          },
        ],
      }),
    });
    if (!ai.ok) {
      const detail = await ai.text().catch(() => "");
      return json({ error: "openai_failed", status: ai.status, detail }, 502);
    }
    const j = await ai.json();
    const raw = j.choices?.[0]?.message?.content?.trim() ?? "{}";
    try {
      const parsed = JSON.parse(raw);
      aiTitle = String(parsed.title ?? "").slice(0, 60);
      aiOverview = String(parsed.overview ?? "");
      aiNextSteps = Array.isArray(parsed.next_steps)
        ? parsed.next_steps.map((s: unknown) => String(s)).slice(0, 6)
        : [];
    } catch {
      // Model returned non-JSON — treat the whole thing as the overview.
      aiOverview = raw;
    }

    if (!aiTitle && !aiOverview) return json({ skipped: "empty_summary" });

    // Build the capsule body MeetingSummaryEntry parses:
    //   🤖 AI Companion summary
    //   {title}
    //   {overview}
    //
    //   Next steps:
    //   • step
    const lines = ["🤖 AI Companion summary"];
    if (aiTitle) lines.push(aiTitle);
    if (aiOverview) lines.push(aiOverview);
    if (aiNextSteps.length > 0) {
      lines.push("", "Next steps:", ...aiNextSteps.map((s) => `• ${s}`));
    }

    const { error: insErr } = await supabase.from("guest_messages").insert({
      guest_call_id: id,
      sender_kind: "system",
      sender_name: "Relay",
      body: lines.join("\n"),
    });
    if (insErr)
      return json({ error: "insert_failed", detail: insErr.message }, 500);

    // Keep the RAG index current (fire-and-forget) — re-embed this session +
    // project. No-op unless APP_URL is set (deployed app); local dev uses the
    // backfill script.
    try {
      const appUrl = Deno.env.get("APP_URL");
      const indexSecret = Deno.env.get("RAG_INDEX_SECRET");
      if (appUrl && indexSecret) {
        void fetch(`${appUrl}/api/staff/index-session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-index-secret": indexSecret,
          },
          body: JSON.stringify({ session_id: id }),
        });
      }
    } catch {
      /* best-effort */
    }

    return json({ ok: true, title: aiTitle });
  } catch (e) {
    return json({ error: "unexpected", detail: String(e) }, 500);
  }
});
