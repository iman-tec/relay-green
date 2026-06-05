import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { guest_call_id } = await req.json();
    if (!guest_call_id) {
      return new Response(JSON.stringify({ error: "guest_call_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: call } = await supabase
      .from("guest_calls")
      .select(
        "guest_name, started_at, thread_id, project_id, customer_user_id, status, engineer_joined_at, customer_joined_at, recording_play_url, summary_state"
      )
      .eq("id", guest_call_id)
      .maybeSingle();

    // If the session is already marked ended, this is a *re-run* — typically
    // triggered by zoom-webhook when the Zoom AI Companion summary lands a
    // few minutes after end-time. The first run already handled all the
    // one-shot side effects (status flip, duration write, "Session ended"
    // message, sentiment row), so re-runs only refresh the summary fields.
    const wasAlreadyEnded =
      (call as { status?: string } | null)?.status === "ended";

    // Helper: write summary_state with a fresh timestamp. The watchdog
    // (tick_summary_watchdog pg_cron) reads summary_state_updated_at to
    // detect stalls, so every transition stamps it.
    const writeState = async (
      state: string,
      extra: Record<string, unknown> = {}
    ) => {
      await supabase
        .from("guest_calls")
        .update({
          summary_state: state,
          summary_state_updated_at: new Date().toISOString(),
          ...extra,
        })
        .eq("id", guest_call_id);
    };

    // Mark "actively generating" so the UI shows a spinner with the right
    // copy and the watchdog has a fresh timestamp to track stalls against.
    // We do this BEFORE the OpenAI call so a crash mid-flight leaves a
    // detectable state (the watchdog will flip it to summary_failed).
    await writeState("generating_session_summary");

    let threadUsed = 0;
    if (call?.thread_id) {
      const { data: t } = await supabase
        .from("guest_threads")
        .select("free_minutes_used")
        .eq("id", call.thread_id)
        .maybeSingle();
      threadUsed = Number(
        (t as { free_minutes_used?: number } | null)?.free_minutes_used ?? 0
      );
    }

    // Compute session duration (minutes) for usage tracking
    const endedAtIso = new Date().toISOString();
    let sessionMinutes = 0;
    if (call?.started_at) {
      sessionMinutes = Math.max(
        0,
        (new Date(endedAtIso).getTime() - new Date(call.started_at).getTime()) /
          60000
      );
    }

    // Pull three signal sources IN PARALLEL:
    //   1. guest_messages — the typed chat (and AI Companion summaries if Zoom delivered them)
    //   2. session_captions — Zoom Live Transcription of what was SPOKEN on the call
    //
    // Captions are batched by the engineer client into ~60s windows and
    // tagged with a speaker. We interleave them with chat chronologically
    // so the model sees a single timeline of "what was said + what was
    // typed + what Zoom heard".
    const [msgsRes, capsRes] = await Promise.all([
      supabase
        .from("guest_messages")
        .select("sender_kind, sender_name, body, created_at")
        .eq("guest_call_id", guest_call_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("session_captions")
        .select("speaker, text, window_start, window_end")
        .eq("session_id", guest_call_id)
        .order("window_end", { ascending: true }),
    ]);
    const msgs = msgsRes.data;
    const caps = (capsRes.data ?? []) as Array<{
      speaker: string | null;
      text: string;
      window_start: string;
      window_end: string;
    }>;

    // Build the prompt corpus chronologically. Sort key:
    //   • chat row: created_at
    //   • caption row: window_end (when the spoken phrase was captured)
    // Each line is tagged distinctly so the model can weigh sources:
    //   • [Zoom AI Companion summary from the call]  — high-confidence
    //   • Speaker (voice): text                       — live transcript
    //   • Name: text                                  — typed chat
    type Line = { ts: number; text: string };
    const lines: Line[] = [];
    for (const m of (msgs ?? []) as any[]) {
      // Drop noise system messages but keep AI Companion blocks.
      if (
        m.sender_kind === "system" &&
        (typeof m.body !== "string" || !m.body.includes("AI Companion summary"))
      ) {
        continue;
      }
      const text =
        m.sender_kind === "system"
          ? `[Zoom AI Companion summary from the call]\n${m.body}`
          : `${m.sender_name ?? m.sender_kind}: ${m.body}`;
      lines.push({ ts: new Date(m.created_at).getTime(), text });
    }
    for (const c of caps) {
      const who = c.speaker ?? "Speaker";
      lines.push({
        ts: new Date(c.window_end).getTime(),
        text: `${who} (voice): ${c.text}`,
      });
    }
    lines.sort((a, b) => a.ts - b.ts);
    const transcript = lines.map((l) => l.text).join("\n");

    // Guard against hallucinated summaries for trivial sessions. A lone
    // "hello" in chat (no real exchange, no Zoom) used to pass the
    // emptiness check below and the model would invent a problem that was
    // never discussed. Require genuine substance before calling OpenAI:
    //   • at least one Zoom AI Companion summary block (the call happened), OR
    //   • a real chat exchange (3+ human messages, or 80+ chars of human text)
    // Anything thinner falls through to the "nothing to summarize" branch,
    // which correctly records no_conversation when Zoom was never joined.
    const humanMsgs = (msgs ?? []).filter(
      (m: any) =>
        m.sender_kind !== "system" &&
        typeof m.body === "string" &&
        m.body.trim().length > 0
    );
    const companionBlocks = (msgs ?? []).filter(
      (m: any) =>
        m.sender_kind === "system" &&
        typeof m.body === "string" &&
        m.body.includes("AI Companion summary")
    );
    const humanChars = humanMsgs.reduce(
      (n: number, m: any) => n + m.body.trim().length,
      0
    );
    // Caption substance: total spoken characters across all batches. A
    // voice-only call may have zero chat but plenty of transcript — that
    // should count.
    const captionChars = caps.reduce(
      (n, c) => n + (c.text?.trim().length ?? 0),
      0
    );
    const hasSubstance =
      companionBlocks.length > 0 ||
      humanMsgs.length >= 3 ||
      humanChars >= 80 ||
      captionChars >= 200;

    if (!transcript.trim() || !hasSubstance) {
      // Distinguish three "nothing to summarize" cases so the UI shows the
      // right copy without waiting on the watchdog:
      //   • Neither party joined Zoom AND no chat                → no_conversation
      //   • Zoom was joined, recording_play_url IS set            → waiting_for_transcript
      //     (the AI Companion summary is in flight)
      //   • Zoom was joined, recording_play_url IS NULL, and the
      //     "Zoom meeting ended" system message is > 60s old      → transcript_unavailable
      //     (Zoom never delivered recording.completed, which means
      //      recording was never started — no summary is coming.)
      //   • Zoom was joined, recording_play_url IS NULL, meeting
      //     ended <= 60s ago (or hasn't ended yet)                → waiting_for_transcript
      //     (give Zoom a beat to deliver the recording webhook)
      const engineerJoinedAt = (
        call as { engineer_joined_at?: string | null } | null
      )?.engineer_joined_at;
      const customerJoinedAt = (
        call as { customer_joined_at?: string | null } | null
      )?.customer_joined_at;
      const recordingPlayUrl = (
        call as { recording_play_url?: string | null } | null
      )?.recording_play_url;
      const zoomTouched =
        !!engineerJoinedAt || !!customerJoinedAt || !!recordingPlayUrl;

      let nextState:
        | "no_conversation"
        | "waiting_for_transcript"
        | "transcript_unavailable";
      if (!zoomTouched) {
        nextState = "no_conversation";
      } else if (recordingPlayUrl) {
        nextState = "waiting_for_transcript";
      } else {
        // Zoom was joined but no recording artifact yet. Check whether the
        // Zoom meeting has already ended (webhook posts the "📞 Zoom
        // meeting ended" system message) and how long ago — if > 60s,
        // Zoom would already have fired recording.completed if recording
        // had been on, so we know it was off.
        const { data: endedMsg } = await supabase
          .from("guest_messages")
          .select("created_at")
          .eq("guest_call_id", guest_call_id)
          .eq("sender_kind", "system")
          .ilike("body", "%Zoom meeting ended%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (endedMsg) {
          const ageSec =
            (Date.now() -
              new Date(
                (endedMsg as { created_at: string }).created_at
              ).getTime()) /
            1000;
          nextState =
            ageSec > 60 ? "transcript_unavailable" : "waiting_for_transcript";
        } else {
          // Zoom still active OR meeting.ended webhook hasn't arrived yet.
          // Either way, give it the watchdog window.
          nextState = "waiting_for_transcript";
        }
      }

      const update: Record<string, unknown> = {
        summary_state: nextState,
        summary_state_updated_at: new Date().toISOString(),
      };
      if (!wasAlreadyEnded) {
        update.status = "ended";
        update.ended_at = endedAtIso;
        update.duration_minutes = sessionMinutes;
        update.free_minutes_used = sessionMinutes;
      }
      await supabase.from("guest_calls").update(update).eq("id", guest_call_id);
      if (!wasAlreadyEnded && call?.thread_id && sessionMinutes > 0) {
        const newTotal = threadUsed + sessionMinutes;
        await supabase
          .from("guest_threads")
          .update({ free_minutes_used: newTotal })
          .eq("id", call.thread_id);
      }
      return new Response(
        JSON.stringify({ summary: null, summary_state: nextState }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Session-level summary: one OpenAI call that returns structured JSON
    // (title + overview + problem + tried + next_steps). The transcript
    // built above includes both the human chat messages and every per-call
    // Zoom AI Companion summary tagged with [Zoom AI Companion summary from
    // the call], so the model sees what was said in chat AND what happened
    // on the video call.
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    let summary = "";
    let aiTitle = "";
    let aiOverview = "";
    let aiNextSteps: string[] = [];

    if (apiKey) {
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
                'You summarize a short engineer↔builder support session. Respond with strict JSON only: {"title": string, "overview": string, "problem": string, "tried": string, "next_steps": string[]}. ' +
                "The transcript interleaves THREE kinds of lines: " +
                "(1) `Name: text` — typed chat between customer and engineer. " +
                "(2) `Speaker (voice): text` — Zoom Live Transcription of what was spoken on the call (this is usually the bulk of the conversation). " +
                "(3) `[Zoom AI Companion summary from the call]` — Zoom's own post-hoc summary block. " +
                "All three are evidence of the same session. Voice transcript is typically the richest source; chat is high-signal short bursts; AI Companion blocks are high-confidence summaries. When sources conflict, prefer the more specific and recent evidence. " +
                'Rules for `title`: 3-5 words, NO period, problem-focused — name the *issue the builder was stuck on*, not the action taken. Examples of good titles: "Auth redirect loop", "Stripe webhook silent fail", "Supabase RLS blocking inserts", "Vite hot reload broken". Bad titles: "Helped a user", "Quick chat", "Discussion about deploy". ' +
                "`overview` = 2-3 sentence TL;DR covering the whole session (which may include multiple Zoom calls). `problem` = 1-2 sentences naming the root cause. `tried` = 1-2 sentences listing what was attempted. `next_steps` = 3-5 short imperative items. No extra prose outside the JSON.",
            },
            {
              role: "user",
              content: `Guest: ${call?.guest_name ?? "Builder"}\n\nTranscript:\n${transcript}`,
            },
          ],
        }),
      });
      if (ai.ok) {
        const j = await ai.json();
        const raw = j.choices?.[0]?.message?.content?.trim() ?? "{}";
        try {
          const parsed = JSON.parse(raw);
          aiTitle = String(parsed.title ?? "").slice(0, 60);
          aiOverview = String(parsed.overview ?? "");
          aiNextSteps = Array.isArray(parsed.next_steps)
            ? parsed.next_steps.map((s: any) => String(s)).slice(0, 6)
            : [];
          const parts: string[] = [];
          if (aiOverview) parts.push(`TL;DR: ${aiOverview}`);
          if (parsed.problem) parts.push(`Problem: ${parsed.problem}`);
          if (parsed.tried) parts.push(`What we tried: ${parsed.tried}`);
          if (aiNextSteps.length > 0) {
            parts.push(
              `Next steps:\n${aiNextSteps.map((s) => `• ${s}`).join("\n")}`
            );
          }
          summary = parts.join("\n\n") || aiOverview || raw;
        } catch {
          summary = raw;
        }
      } else {
        const errText = await ai.text().catch(() => "");
        console.error(
          "[summarize-guest-call] OpenAI error",
          ai.status,
          errText
        );
        summary = `Summary unavailable (AI error ${ai.status}).`;
      }
    } else {
      // No OPENAI_API_KEY configured — fall back to the raw transcript so
      // the sidebar still shows something useful.
      summary = transcript.slice(0, 800);
    }

    // Did the OpenAI call actually produce something we can show as a
    // summary? Three failure shapes feed into summary_failed:
    //   1. No API key + no transcript fallback
    //   2. OpenAI non-2xx response (summary text starts with "Summary unavailable")
    //   3. summary is empty/whitespace
    const openAiFailed =
      !summary ||
      !summary.trim() ||
      summary.startsWith("Summary unavailable (AI error");

    // Always refresh the summary fields. Duration / status / ended_at are
    // one-shot at first end — re-runs (Zoom AI Companion arriving late) skip
    // those so we don't overwrite the original end-time with a later
    // timestamp or double-count free minutes.
    const update: Record<string, unknown> = {
      summary,
      ai_summary_title: aiTitle || null,
      ai_summary_overview: aiOverview || null,
      ai_next_steps: aiNextSteps.length > 0 ? aiNextSteps : null,
      summary_state: openAiFailed ? "summary_failed" : "summary_ready",
      summary_state_updated_at: new Date().toISOString(),
    };
    if (!wasAlreadyEnded) {
      update.status = "ended";
      update.ended_at = endedAtIso;
      update.duration_minutes = sessionMinutes;
      update.free_minutes_used = sessionMinutes;
    }
    await supabase.from("guest_calls").update(update).eq("id", guest_call_id);

    // Increment cumulative free minutes used on the thread — first run only.
    if (!wasAlreadyEnded && call?.thread_id && sessionMinutes > 0) {
      const newTotal = threadUsed + sessionMinutes;
      await supabase
        .from("guest_threads")
        .update({ free_minutes_used: newTotal })
        .eq("id", call.thread_id);
    }

    // The "Session ended. Summary saved." chat chip is a one-shot signal —
    // re-runs don't post a duplicate.
    if (!wasAlreadyEnded) {
      await supabase.from("guest_messages").insert({
        guest_call_id,
        sender_kind: "system",
        sender_name: "Relay",
        body: "Session ended. Summary saved.",
      });
    }

    // ── Per-call summary capsule ─────────────────────────────────────────
    // The customer-facing "Call summary" card (MeetingSummaryEntry) renders
    // any system message whose body contains "AI Companion summary", parsed
    // as: header line → title → overview → "Next steps:" bullets. That card
    // used to be fed only by Zoom's AI Companion webhook (meeting.summary_
    // completed), which never fires for Video SDK sessions. We now post the
    // same-shaped message ourselves from the OpenAI summary built off the
    // Whisper voice transcript + chat, so the capsule fills regardless of
    // Zoom's ASR/Companion entitlements.
    //
    // Insert ONCE: skip if any AI-Companion-shaped system message already
    // exists for this call (`companionBlocks`, computed above). That makes
    // re-runs idempotent and never clobbers a card the customer has edited,
    // and it defers to a real Zoom Companion summary if one ever arrives.
    if (!openAiFailed && companionBlocks.length === 0 && aiTitle) {
      const capsuleLines = ["🤖 AI Companion summary", aiTitle];
      if (aiOverview) capsuleLines.push(aiOverview);
      if (aiNextSteps.length > 0) {
        capsuleLines.push(
          "",
          "Next steps:",
          ...aiNextSteps.map((s) => `• ${s}`)
        );
      }
      await supabase.from("guest_messages").insert({
        guest_call_id,
        sender_kind: "system",
        sender_name: "Relay",
        body: capsuleLines.join("\n"),
      });
    }

    // ── Post-session sentiment score ─────────────────────────────────────────
    // Feeds the colored health bar on the supervise pit and the feedback
    // feed in /finance.
    //
    // Lifecycle: this function runs at end-time (chat-only — Zoom AI
    // Companion hasn't delivered yet) AND again when zoom-webhook posts
    // the AI Companion summary 1-5 minutes later. We RE-COMPUTE sentiment
    // on every run because the second run has a strictly richer
    // aiOverview (the OpenAI summary call above sees chat + Zoom
    // observations interleaved). Older builds gated this on
    // "row already exists" → sentiment stayed frozen on the chat-only
    // snapshot. Now we UPSERT keyed on the post-end marker
    // (window_start IS NULL — score-session-health always sets a
    // non-null window_start) and only persist when the model actually
    // produced a score, so a transient OpenAI failure on the re-run
    // doesn't overwrite a good earlier reading with neutral 0.
    const { data: existingSentiment } = await supabase
      .from("session_health")
      .select("id")
      .eq("session_id", guest_call_id)
      .is("window_start", null)
      .limit(1)
      .maybeSingle();
    try {
      // Input priority: aiOverview is the freshly-generated OpenAI summary
      // built from chat + every "[Zoom AI Companion summary from the call]"
      // block (see the transcript build at the top of the function). On the
      // re-run triggered by zoom-webhook after Zoom delivers, aiOverview is
      // strictly richer than on the original run. summary is the formatted
      // multi-section version; transcript head is the last-resort fallback.
      const sentimentInput =
        (aiOverview && aiOverview.trim()) ||
        (summary && summary.trim()) ||
        transcript.slice(0, 2000).trim();

      let score = 0;
      let scoreBlurb = "Post-session sentiment.";
      // Did the model actually return a usable score? If not we don't want
      // to overwrite a previously-good reading with a default neutral.
      let scored = false;

      if (apiKey && sentimentInput.length > 0) {
        const ai = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 120,
            messages: [
              {
                role: "system",
                content:
                  "You rate the sentiment of a completed customer-support session given its summary. " +
                  "The summary may incorporate signals from both chat and the live video call's AI Companion observations — weigh both equally; do not assume chat-only context. " +
                  'Return STRICT JSON only: {"score": number, "summary": string}.\n' +
                  "score is a number in [-1.0, +1.0]:\n" +
                  "  +1.0  problem fully resolved AND customer expresses gratitude / clear satisfaction.\n" +
                  "  +0.4  solution delivered, mild positive tone, no friction.\n" +
                  "   0.0  neutral, informational, ambiguous, or insufficient evidence.\n" +
                  "  -0.4  problem unresolved at end, customer mildly frustrated.\n" +
                  "  -1.0  customer angry, abusive, or threatened to churn / refund.\n" +
                  "Rules — minimize false positives:\n" +
                  "• When evidence is thin or ambiguous, default to 0.0. Do not infer happiness from a polite closing.\n" +
                  "• Only score >= +0.5 if the summary explicitly says the issue was resolved AND the customer reacted positively.\n" +
                  "• Only score <= -0.5 if there is explicit evidence of strong frustration, anger, or an unresolved blocker the customer flagged.\n" +
                  "• Engineer-only neutral tone is 0.0, not negative.\n" +
                  "• A short or terse summary is 0.0, not negative.\n" +
                  "summary = one short sentence (<= 80 chars) explaining the score.",
              },
              {
                role: "user",
                content: sentimentInput.slice(0, 4000),
              },
            ],
          }),
        });

        if (ai.ok) {
          const j = await ai.json();
          const raw = j.choices?.[0]?.message?.content?.trim() ?? "{}";
          try {
            const parsed = JSON.parse(raw);
            const n = Number(parsed.score);
            if (Number.isFinite(n)) {
              score = Math.max(-1, Math.min(1, n));
              scored = true;
            }
            const blurb =
              typeof parsed.summary === "string" ? parsed.summary.trim() : "";
            if (blurb) scoreBlurb = blurb.slice(0, 200);
          } catch {
            // Malformed JSON from the model — leave scored=false so we
            // don't overwrite a previous good reading.
          }
        } else {
          console.error(
            "[summarize-guest-call] sentiment OpenAI error",
            ai.status,
            await ai.text().catch(() => "")
          );
        }
      }

      // Persist. UPSERT semantics keyed off the post-end marker row
      // (window_start IS NULL): UPDATE if one already exists, INSERT
      // otherwise. We skip the overwrite when the model failed AND a
      // prior reading exists, so a flaky OpenAI call on the Zoom-arrived
      // re-run doesn't replace a real chat-only score with neutral 0.
      const shouldOverwrite = scored || !existingSentiment;
      if (shouldOverwrite) {
        if (existingSentiment) {
          await supabase
            .from("session_health")
            .update({
              score,
              summary: scoreBlurb,
              computed_at: new Date().toISOString(),
              window_end: endedAtIso,
            })
            .eq("id", (existingSentiment as { id: string }).id);
        } else {
          await supabase.from("session_health").insert({
            session_id: guest_call_id,
            score,
            summary: scoreBlurb,
            window_start: null,
            window_end: endedAtIso,
            message_count: 0,
          });
        }
        // Defensive copy onto the guest_calls row itself — guarantees the
        // supervisor PastSessionTile can render sentiment even if the
        // session_health view ever misses a row. Migration
        // 20260520200000_bugs2_fixes adds these columns.
        await supabase
          .from("guest_calls")
          .update({
            final_sentiment_score: score,
            final_sentiment_summary: scoreBlurb,
          })
          .eq("id", guest_call_id);
        // New supervisor table (20260604100000_sup_sentiment): one
        // phase='final' row holding the post-end sentiment derived from the
        // CUMULATIVE session summary. Written last so it becomes the
        // latest_sup_sentiment row for the session; its `state` column
        // derives the orange/red thresholds in the DB. Best-effort — the
        // legacy paths above already persist the same reading.
        try {
          await supabase.from("sup_sentiment").insert({
            session_id: guest_call_id,
            score,
            summary: scoreBlurb,
            activeness: null,
            phase: "final",
          });
        } catch (e) {
          console.warn(
            "[summarize-guest-call] sup_sentiment final insert failed:",
            e
          );
        }
      }
    } catch (e) {
      console.error("[summarize-guest-call] sentiment scoring failed:", e);
    }

    // Refresh the rolling "about this customer" brief for the thread.
    if (call?.thread_id) {
      try {
        await supabase.functions.invoke("regenerate-guest-brief", {
          body: { thread_id: call.thread_id },
        });
      } catch (e) {
        console.error("brief refresh failed:", e);
      }
    }

    // Cascade the summary roll-up: session → project → customer. We only
    // roll up at higher levels when the session has a parent (project /
    // customer). The General bucket (no project_id) and anonymous guests
    // (no customer_user_id) stop here with just the session summary.
    const projectId =
      (call as { project_id?: string | null } | null)?.project_id ?? null;
    const customerUserId =
      (call as { customer_user_id?: string | null } | null)?.customer_user_id ??
      null;
    if (projectId) {
      try {
        await supabase.functions.invoke("summarize-project", {
          body: { project_id: projectId },
        });
      } catch (e) {
        console.error("[summarize-guest-call] project cascade failed:", e);
      }
    } else if (customerUserId) {
      // No project on this session, but it's a logged-in customer — still
      // refresh the customer-level summary so their profile reflects this
      // session even if it landed in the General bucket.
      try {
        await supabase.functions.invoke("summarize-customer", {
          body: { customer_id: customerUserId },
        });
      } catch (e) {
        console.error("[summarize-guest-call] customer cascade failed:", e);
      }
    }

    // Keep the RAG index current (fire-and-forget). The Node indexer parses
    // PDFs/DOCX and re-embeds this session + the project rollup. Active only
    // when APP_URL is set (the deployed app URL); a no-op in local dev, where
    // the backfill script handles indexing.
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
          body: JSON.stringify({ session_id: guest_call_id }),
        });
      }
    } catch {
      /* best-effort */
    }

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Try to flip summary_state to summary_failed so the UI doesn't hang on
    // "generating..." until the watchdog catches it. Best-effort — if the
    // request never had a session id (the early 400 path) or the DB write
    // itself fails, just return the original error.
    try {
      const { guest_call_id } = (await req
        .clone()
        .json()
        .catch(() => ({}))) as { guest_call_id?: string };
      if (guest_call_id) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await supabase
          .from("guest_calls")
          .update({
            summary_state: "summary_failed",
            summary_state_updated_at: new Date().toISOString(),
          })
          .eq("id", guest_call_id);
      }
    } catch (e2) {
      console.error(
        "[summarize-guest-call] state-failed write also failed:",
        e2
      );
    }
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
