import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
      .select("guest_name, started_at, thread_id, project_id, customer_user_id")
      .eq("id", guest_call_id)
      .maybeSingle();

    let threadUsed = 0;
    if (call?.thread_id) {
      const { data: t } = await supabase
        .from("guest_threads")
        .select("free_minutes_used")
        .eq("id", call.thread_id)
        .maybeSingle();
      threadUsed = Number((t as { free_minutes_used?: number } | null)?.free_minutes_used ?? 0);
    }

    // Compute session duration (minutes) for usage tracking
    const endedAtIso = new Date().toISOString();
    let sessionMinutes = 0;
    if (call?.started_at) {
      sessionMinutes = Math.max(
        0,
        (new Date(endedAtIso).getTime() - new Date(call.started_at).getTime()) / 60000,
      );
    }

    const { data: msgs } = await supabase
      .from("guest_messages")
      .select("sender_kind, sender_name, body, created_at")
      .eq("guest_call_id", guest_call_id)
      .order("created_at", { ascending: true });

    const transcript = (msgs ?? [])
      .filter((m: any) => m.sender_kind !== "system")
      .map((m: any) => `${m.sender_name ?? m.sender_kind}: ${m.body}`)
      .join("\n");

    if (!transcript.trim()) {
      const summary = "No conversation captured.";
      await supabase
        .from("guest_calls")
        .update({
          summary,
          status: "ended",
          ended_at: endedAtIso,
          duration_minutes: sessionMinutes,
          free_minutes_used: sessionMinutes,
        })
        .eq("id", guest_call_id);
      if (call?.thread_id && sessionMinutes > 0) {
        const newTotal = threadUsed + sessionMinutes;
        await supabase.from("guest_threads").update({ free_minutes_used: newTotal }).eq("id", call.thread_id);
      }
      return new Response(JSON.stringify({ summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Session-level summary: one OpenAI call that returns structured JSON
    // (title + overview + problem + tried + next_steps). The aggregate
    // covers every per-call Zoom AI Companion summary in the chat plus
    // the human messages — the transcript already includes both (the AI
    // Companion summaries are stored as system messages, but those are
    // filtered out above to keep the prompt focused on what humans said).
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
                "You summarize a short engineer↔builder support session. Respond with strict JSON only: {\"title\": string, \"overview\": string, \"problem\": string, \"tried\": string, \"next_steps\": string[]}. " +
                "Rules for `title`: 3-5 words, NO period, problem-focused — name the *issue the builder was stuck on*, not the action taken. Examples of good titles: \"Auth redirect loop\", \"Stripe webhook silent fail\", \"Supabase RLS blocking inserts\", \"Vite hot reload broken\". Bad titles: \"Helped a user\", \"Quick chat\", \"Discussion about deploy\". " +
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
            parts.push(`Next steps:\n${aiNextSteps.map((s) => `• ${s}`).join("\n")}`);
          }
          summary = parts.join("\n\n") || aiOverview || raw;
        } catch {
          summary = raw;
        }
      } else {
        const errText = await ai.text().catch(() => "");
        console.error("[summarize-guest-call] OpenAI error", ai.status, errText);
        summary = `Summary unavailable (AI error ${ai.status}).`;
      }
    } else {
      // No OPENAI_API_KEY configured — fall back to the raw transcript so
      // the sidebar still shows something useful.
      summary = transcript.slice(0, 800);
    }

    await supabase
      .from("guest_calls")
      .update({
        summary,
        ai_summary_title: aiTitle || null,
        ai_summary_overview: aiOverview || null,
        ai_next_steps: aiNextSteps.length > 0 ? aiNextSteps : null,
        status: "ended",
        ended_at: endedAtIso,
        duration_minutes: sessionMinutes,
        free_minutes_used: sessionMinutes,
      })
      .eq("id", guest_call_id);

    // Increment cumulative free minutes used on the thread
    if (call?.thread_id && sessionMinutes > 0) {
      const newTotal = threadUsed + sessionMinutes;
      await supabase
        .from("guest_threads")
        .update({ free_minutes_used: newTotal })
        .eq("id", call.thread_id);
    }

    await supabase.from("guest_messages").insert({
      guest_call_id,
      sender_kind: "system",
      sender_name: "Relay",
      body: "Session ended. Summary saved.",
    });

    // ── Post-session sentiment score ─────────────────────────────────────────
    // Feeds the colored health bar on the supervise pit and the feedback
    // feed in /finance. Runs ONCE per session at end-time. The model is
    // tuned to lean neutral (low false-positive rate) — only commits to a
    // strong score when the summary has explicit evidence.
    //
    // Input priority: ai_summary_overview > full summary > transcript head.
    // If we have nothing usable (no API key, empty transcript), we write a
    // neutral 0 row so the UI doesn't fall back to the stale per-minute
    // score from earlier in the session.
    try {
      const sentimentInput =
        (aiOverview && aiOverview.trim()) ||
        (summary && summary.trim()) ||
        transcript.slice(0, 2000).trim();

      let score = 0;
      let scoreBlurb = "Post-session sentiment.";

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
                  "Return STRICT JSON only: {\"score\": number, \"summary\": string}.\n" +
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
            }
            const blurb = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
            if (blurb) scoreBlurb = blurb.slice(0, 200);
          } catch {
            // Malformed JSON from the model — keep score=0 neutral.
          }
        } else {
          console.error(
            "[summarize-guest-call] sentiment OpenAI error",
            ai.status,
            await ai.text().catch(() => ""),
          );
        }
      }

      await supabase.from("session_health").insert({
        session_id: guest_call_id,
        score,
        summary: scoreBlurb,
        window_start: null,
        window_end:   endedAtIso,
        message_count: 0,
      });
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
    const projectId = (call as { project_id?: string | null } | null)?.project_id ?? null;
    const customerUserId = (call as { customer_user_id?: string | null } | null)?.customer_user_id ?? null;
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

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
