/*
 * transcribe-chunk — Whisper fallback for live transcription.
 *
 * The Zoom Video SDK account does NOT have the native Live Transcription
 * (ASR) entitlement (startLiveTranscription rejects with errorCode 7300), so
 * each participant's browser records its OWN microphone in ~30s slices and
 * POSTs them here. We run the slice through OpenAI Whisper and append the
 * result to `session_captions` — the same table `summarize-guest-call` and
 * `score-session-health` already read. Because each side records only its own
 * mic, the audio is clean single-speaker and the `speaker` label is exact.
 *
 * Request: multipart/form-data
 *   file        — audio blob (webm/opus or mp4)
 *   session_id  — guest_calls.id (uuid)
 *   speaker     — display name of the local participant (optional)
 *   started_at  — ISO timestamp the slice began (optional; defaults to now-30s)
 *
 * Insert uses the service-role client (bypasses RLS) so both the engineer
 * (host) and the customer (guest) can contribute captions for their session.
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

// Whisper reliably hallucinates boilerplate on (near-)silent audio — subtitle
// credits, "thank you", etc. Drop these so the transcript (and the summary
// built from it) stays clean.
const SILENCE_HALLUCINATIONS = new Set(
  [
    "you",
    "thank you.",
    "thank you",
    "thanks for watching!",
    "thanks for watching.",
    "please subscribe.",
    "subtitles by the amara.org community",
    ".",
    "...",
  ].map((s) => s.toLowerCase())
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "openai_key_missing" }, 500);

    const form = await req.formData();
    const file = form.get("file");
    const sessionId = String(form.get("session_id") ?? "").trim();
    const speakerRaw = form.get("speaker");
    const speaker =
      typeof speakerRaw === "string" && speakerRaw.trim().length > 0
        ? speakerRaw.trim()
        : null;
    const startedAtRaw = form.get("started_at");

    if (!(file instanceof File) || file.size === 0)
      return json({ error: "file_missing" }, 400);
    if (!sessionId) return json({ error: "session_id_missing" }, 400);

    // Tiny slices are silence/keyframe-only — skip without burning a Whisper
    // call. ~2KB is well below a second of opus speech.
    if (file.size < 2000) return json({ skipped: "too_small" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Cheap guard against junk session ids: the call must exist. (Also lets us
    // denormalize zoom_meeting_id onto the caption row, matching the LTT path.)
    const { data: call, error: callErr } = await supabase
      .from("guest_calls")
      .select("id, zoom_meeting_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (callErr)
      return json({ error: "lookup_failed", detail: callErr.message }, 500);
    if (!call) return json({ error: "session_not_found" }, 404);

    // ── Whisper transcription ─────────────────────────────────────────────
    const oaForm = new FormData();
    oaForm.append("file", file, file.name || "audio.webm");
    oaForm.append("model", "whisper-1");
    oaForm.append("language", "en");
    oaForm.append("response_format", "json");
    oaForm.append("temperature", "0");

    const oa = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: oaForm,
    });
    if (!oa.ok) {
      const detail = await oa.text().catch(() => "");
      return json({ error: "whisper_failed", status: oa.status, detail }, 502);
    }
    const out = (await oa.json()) as { text?: string };
    const text = (out.text ?? "").replace(/\s+/g, " ").trim();

    if (!text || SILENCE_HALLUCINATIONS.has(text.toLowerCase()))
      return json({ skipped: "empty_or_silence" });

    // ── Persist ───────────────────────────────────────────────────────────
    const now = new Date();
    let windowStart = new Date(now.getTime() - 30_000);
    if (typeof startedAtRaw === "string") {
      const parsed = new Date(startedAtRaw);
      if (!Number.isNaN(parsed.getTime())) windowStart = parsed;
    }

    const { error: insErr } = await supabase.from("session_captions").insert({
      session_id: sessionId,
      zoom_meeting_id: call.zoom_meeting_id ?? null,
      speaker,
      text,
      window_start: windowStart.toISOString(),
      window_end: now.toISOString(),
    });
    if (insErr)
      return json({ error: "insert_failed", detail: insErr.message }, 500);

    return json({ ok: true, chars: text.length });
  } catch (e) {
    return json({ error: "unexpected", detail: String(e) }, 500);
  }
});
