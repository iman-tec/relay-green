// Regenerates the rolling "about this customer" AI brief for a guest_thread.
// Triggered after a session's AI summary lands. Uses Lovable AI Gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const { thread_id } = await req.json();
    if (!thread_id) {
      return new Response(JSON.stringify({ error: "thread_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: thread } = await admin
      .from("guest_threads")
      .select("*")
      .eq("id", thread_id)
      .maybeSingle();
    if (!thread) {
      return new Response(JSON.stringify({ error: "thread not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: calls } = await admin
      .from("guest_calls")
      .select(
        "id, created_at, agent_name, duration_minutes, summary, ai_summary_overview, ai_next_steps"
      )
      .eq("thread_id", thread_id)
      .order("created_at", { ascending: true });

    const sessionsBlock = (calls ?? [])
      .map((c: any, i: number) => {
        const next = Array.isArray(c.ai_next_steps)
          ? c.ai_next_steps
              .map((s: any) =>
                typeof s === "string" ? s : (s?.text ?? s?.description)
              )
              .filter(Boolean)
              .join("; ")
          : "";
        return [
          `### Session ${i + 1} · ${new Date(c.created_at).toLocaleDateString()} · agent ${c.agent_name ?? "unknown"} · ${c.duration_minutes ?? "?"} min`,
          c.ai_summary_overview || c.summary || "(no summary)",
          next ? `Next steps: ${next}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const apiKey =
      Deno.env.get("GROQ_API_KEY") ?? Deno.env.get("LOVABLE_API_KEY");
    let brief = "";
    if (apiKey && sessionsBlock.trim()) {
      const ai = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content:
                  "You write a tight 'about this customer' brief for the next support engineer joining a chat. Plain text, no markdown headers. Max 5 short lines covering: who they are, recurring themes/issues, tools/stack mentioned, current status, suggested next step. Be specific, not generic.",
              },
              {
                role: "user",
                content: `Customer: ${thread.display_name}${thread.guest_email ? ` (${thread.guest_email})` : ""}\nTotal sessions: ${calls?.length ?? 0}\n\n${sessionsBlock}`,
              },
            ],
          }),
        }
      );
      if (ai.ok) {
        const j = await ai.json();
        brief = j.choices?.[0]?.message?.content?.trim() ?? "";
      } else {
        console.error("AI brief failed", ai.status, await ai.text());
      }
    }

    if (brief) {
      await admin
        .from("guest_threads")
        .update({
          rolling_brief: brief,
          brief_updated_at: new Date().toISOString(),
        })
        .eq("id", thread_id);
    }

    return new Response(JSON.stringify({ brief }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
