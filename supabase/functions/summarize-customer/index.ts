// Customer-level AI summary. Rolls up every project-level summary owned
// by one customer into one OpenAI-generated overview and upserts it into
// public.customer_summaries (PK = customer_id).
//
// Invoked automatically by summarize-project after a project roll-up
// completes. Safe to call directly with { customer_id } to backfill.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { customer_id } = await req.json();
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pull every project belonging to this customer that has a summary.
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, ai_summary_title, ai_summary_overview, ai_next_steps, summary_updated_at")
      .eq("customer_id", customer_id)
      .order("summary_updated_at", { ascending: false, nullsFirst: false });

    const rows = (projects ?? []) as Array<{
      id: string;
      name: string;
      ai_summary_title: string | null;
      ai_summary_overview: string | null;
      ai_next_steps: unknown;
    }>;

    const withSummary = rows.filter((p) => p.ai_summary_overview || p.ai_summary_title);

    if (withSummary.length === 0) {
      // No project summaries available — clear any stale roll-up.
      await supabase
        .from("customer_summaries")
        .upsert(
          {
            customer_id,
            ai_summary_title: null,
            ai_summary_overview: null,
            ai_next_steps: null,
            summary: null,
            summary_updated_at: new Date().toISOString(),
          },
          { onConflict: "customer_id" },
        );
      return new Response(JSON.stringify({ ok: true, summarized_projects: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transcript = withSummary
      .map((p, i) => {
        const parts: string[] = [`Project ${i + 1}: ${p.name}`];
        if (p.ai_summary_title) parts.push(`Title: ${p.ai_summary_title}`);
        if (p.ai_summary_overview) parts.push(`Overview: ${p.ai_summary_overview}`);
        if (Array.isArray(p.ai_next_steps) && p.ai_next_steps.length > 0) {
          const steps = (p.ai_next_steps as Array<string | { text?: string; description?: string }>)
            .map((x) => (typeof x === "string" ? x : x?.text ?? x?.description ?? ""))
            .filter(Boolean);
          if (steps.length > 0) parts.push(`Outstanding: ${steps.join("; ")}`);
        }
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
                "You roll up multiple project-level summaries that belong to one builder into a single customer-level profile summary. Respond with strict JSON only: {\"title\": string, \"overview\": string, \"recurring_themes\": string, \"next_steps\": string[]}. " +
                "Rules for `title`: 3-5 words, NO period, describe the *builder's overall focus* across all projects — e.g. \"AI-native SaaS builder\", \"Solo founder Stripe-heavy\". " +
                "`overview` = 3-5 sentences capturing what this builder works on, what kind of support they tend to need, and recurring patterns across projects. " +
                "`recurring_themes` = 1-2 sentences naming the persistent themes (tech stack, problem domain, support pattern). " +
                "`next_steps` = 3-5 short imperative items, deduplicated across projects. Skip steps that look already resolved. No extra prose outside the JSON.",
            },
            {
              role: "user",
              content: transcript,
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
            ? parsed.next_steps.map((s: any) => String(s)).slice(0, 10)
            : [];
          const parts: string[] = [];
          if (aiOverview) parts.push(`TL;DR: ${aiOverview}`);
          if (parsed.recurring_themes) parts.push(`Recurring themes: ${parsed.recurring_themes}`);
          if (aiNextSteps.length > 0) {
            parts.push(`Outstanding:\n${aiNextSteps.map((s) => `• ${s}`).join("\n")}`);
          }
          summary = parts.join("\n\n") || aiOverview || raw;
        } catch {
          summary = raw;
        }
      } else {
        const errText = await ai.text().catch(() => "");
        console.error("[summarize-customer] OpenAI error", ai.status, errText);
        summary = `Customer summary unavailable (AI error ${ai.status}).`;
      }
    } else {
      summary = transcript.slice(0, 1500);
    }

    await supabase
      .from("customer_summaries")
      .upsert(
        {
          customer_id,
          ai_summary_title: aiTitle || null,
          ai_summary_overview: aiOverview || null,
          ai_next_steps: aiNextSteps.length > 0 ? aiNextSteps : null,
          summary,
          summary_updated_at: new Date().toISOString(),
        },
        { onConflict: "customer_id" },
      );

    return new Response(JSON.stringify({ ok: true, summarized_projects: withSummary.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
