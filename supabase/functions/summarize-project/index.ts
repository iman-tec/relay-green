// Project-level AI summary. Rolls up every ended session in a project
// (title + overview + next_steps) into one OpenAI-generated summary and
// writes it back to public.projects.ai_summary_*.
//
// Invoked automatically by summarize-guest-call after a session ends.
// Safe to call directly with { project_id } if you want to backfill or
// manually re-roll.

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
    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Confirm the project exists and grab its name + owner (we cascade to
    // the customer summary after this).
    const { data: project } = await supabase
      .from("projects")
      .select("id, customer_id, name")
      .eq("id", project_id)
      .maybeSingle();
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull every ended session's existing AI summary for this project.
    const { data: sessions } = await supabase
      .from("guest_calls")
      .select(
        "id, ai_summary_title, ai_summary_overview, ai_next_steps, summary, started_at, ended_at, duration_minutes"
      )
      .eq("project_id", project_id)
      .eq("status", "ended")
      .order("ended_at", { ascending: true });

    const rows = (sessions ?? []) as Array<{
      id: string;
      ai_summary_title: string | null;
      ai_summary_overview: string | null;
      ai_next_steps: unknown;
      summary: string | null;
      duration_minutes: number | null;
    }>;

    if (rows.length === 0) {
      // No sessions yet — clear any stale roll-up so the UI shows "no
      // summary yet" instead of dragging an old one along.
      await supabase
        .from("projects")
        .update({
          ai_summary_title: null,
          ai_summary_overview: null,
          ai_next_steps: null,
          summary: null,
          summary_updated_at: new Date().toISOString(),
        })
        .eq("id", project_id);
      return new Response(
        JSON.stringify({ ok: true, summarized_sessions: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const transcript = rows
      .map((s, i) => {
        const parts: string[] = [`Session ${i + 1}:`];
        if (s.ai_summary_title) parts.push(`Title: ${s.ai_summary_title}`);
        if (s.ai_summary_overview)
          parts.push(`Overview: ${s.ai_summary_overview}`);
        if (Array.isArray(s.ai_next_steps) && s.ai_next_steps.length > 0) {
          const steps = (
            s.ai_next_steps as Array<
              string | { text?: string; description?: string }
            >
          )
            .map((x) =>
              typeof x === "string" ? x : (x?.text ?? x?.description ?? "")
            )
            .filter(Boolean);
          if (steps.length > 0) parts.push(`Next steps: ${steps.join("; ")}`);
        }
        if (s.duration_minutes)
          parts.push(`Duration: ${Math.round(Number(s.duration_minutes))} min`);
        return parts.join("\n");
      })
      .join("\n\n");

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    let aiTitle = "";
    let aiOverview = "";
    let aiNextSteps: string[] = [];
    let summary = "";

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
                'You roll up multiple engineer-support session summaries inside one project into a single project-level summary. Respond with strict JSON only: {"title": string, "overview": string, "themes": string, "next_steps": string[]}. ' +
                'Rules for `title`: 3-5 words, NO period, describe the *project\'s recurring focus* — e.g. "Stripe integration", "Supabase RLS hardening", "Vite build fixes". ' +
                "`overview` = 3-5 sentences covering the project's overall arc across sessions. " +
                "`themes` = 1-2 sentences naming the recurring problems / patterns. " +
                "`next_steps` = 3-5 short imperative items that aggregate or supersede per-session next steps; deduplicate. No extra prose outside the JSON.",
            },
            {
              role: "user",
              content: `Project: ${project.name}\n\n${transcript}`,
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
            ? parsed.next_steps.map((s: any) => String(s)).slice(0, 8)
            : [];
          const parts: string[] = [];
          if (aiOverview) parts.push(`TL;DR: ${aiOverview}`);
          if (parsed.themes) parts.push(`Themes: ${parsed.themes}`);
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
        console.error("[summarize-project] OpenAI error", ai.status, errText);
        summary = `Project summary unavailable (AI error ${ai.status}).`;
      }
    } else {
      summary = transcript.slice(0, 1200);
    }

    await supabase
      .from("projects")
      .update({
        ai_summary_title: aiTitle || null,
        ai_summary_overview: aiOverview || null,
        ai_next_steps: aiNextSteps.length > 0 ? aiNextSteps : null,
        summary,
        summary_updated_at: new Date().toISOString(),
      })
      .eq("id", project_id);

    // Cascade up — only when this project is owned by an auth user.
    if (project.customer_id) {
      try {
        await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/summarize-customer`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ customer_id: project.customer_id }),
          }
        );
      } catch (e) {
        console.error(
          "[summarize-project] cascade to summarize-customer failed:",
          e
        );
      }
    }

    // Keep the RAG index's project-level chunks (meta + intake) current —
    // fire-and-forget. No-op unless APP_URL is set (deployed app).
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
          body: JSON.stringify({ project_id }),
        });
      }
    } catch {
      /* best-effort */
    }

    return new Response(
      JSON.stringify({ ok: true, summarized_sessions: rows.length }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
