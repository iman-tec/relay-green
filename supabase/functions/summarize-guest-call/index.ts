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
      .select("guest_name, started_at, thread_id")
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

    const apiKey = Deno.env.get("GROQ_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY");
    let summary = "";
    let aiTitle = "";
    let aiOverview = "";
    let aiNextSteps: string[] = [];

    if (apiKey) {
      // Single AI call returns JSON with title + overview + next steps so the
      // sidebar can show a meaningful 4-word label and the right panel can
      // render structured sections.
      const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You summarize a short engineer↔builder support call. Respond with strict JSON only: {\"title\": string, \"overview\": string, \"problem\": string, \"tried\": string, \"next_steps\": string[]}. " +
                "Rules for `title`: 3-5 words, NO period, problem-focused — name the *issue the builder was stuck on*, not the action taken. Examples of good titles: \"Auth redirect loop\", \"Stripe webhook silent fail\", \"Supabase RLS blocking inserts\", \"Vite hot reload broken\". Bad titles: \"Helped a user\", \"Quick chat\", \"Discussion about deploy\". " +
                "`overview` = 2-3 sentence TL;DR. `problem` = 1-2 sentences naming the root cause. `tried` = 1-2 sentences listing what was attempted. `next_steps` = 3-5 short imperative items. No extra prose outside the JSON.",
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
          // Build the human-readable summary from the structured fields.
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
        summary = `Summary unavailable (AI error ${ai.status}).`;
      }
    } else {
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
