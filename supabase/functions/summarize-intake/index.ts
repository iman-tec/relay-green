// Intake-transcript summary. Reads the bot↔customer transcript captured in
// client_intakes.intake_messages plus the structured wizard fields, asks an
// LLM for a tight engineer-ready brief, and writes it back to
// client_intakes.intake_summary.
//
// Invoked from the customer's MatchingClient the moment an engineer accepts
// (before redirecting to /room). Safe to call directly with { intake_id }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type IntakeMessage = {
  role: "assistant" | "user";
  body: string;
  attachment?: { name: string; mime: string; previewUrl?: string };
  created_at: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { intake_id } = await req.json();
    if (!intake_id) {
      return new Response(JSON.stringify({ error: "intake_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: intake } = await supabase
      .from("client_intakes")
      .select("id, familiarity, ai_tools_used, developing, technologies, intake_messages")
      .eq("id", intake_id)
      .maybeSingle();

    if (!intake) {
      return new Response(JSON.stringify({ error: "intake not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = intake as {
      familiarity: string;
      ai_tools_used: string;
      developing: string;
      technologies: string[] | null;
      intake_messages: IntakeMessage[] | null;
    };

    const messages = Array.isArray(row.intake_messages) ? row.intake_messages : [];
    const userTurns = messages.filter((m) => m.role === "user");
    const attachmentCount = messages.reduce(
      (n, m) => (m.attachment ? n + 1 : n),
      0,
    );

    if (userTurns.length === 0) {
      // Nothing said yet — write a stub from the wizard answers so engineer
      // still has *something* in the tray.
      const stub = [
        `Familiarity: ${row.familiarity}`,
        `Building: ${row.developing}`,
        row.ai_tools_used ? `AI tools: ${row.ai_tools_used}` : null,
        row.technologies?.length ? `Stack: ${row.technologies.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      await supabase
        .from("client_intakes")
        .update({
          intake_summary: stub || "Customer started ringing without typing anything yet.",
          intake_summary_updated_at: new Date().toISOString(),
        })
        .eq("id", intake_id);
      return new Response(
        JSON.stringify({ ok: true, user_turns: 0, attachments: attachmentCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const transcript = messages
      .map((m) => {
        const who = m.role === "assistant" ? "Bot" : "Customer";
        const att = m.attachment ? ` [attached ${m.attachment.mime}: ${m.attachment.name}]` : "";
        return `${who}: ${m.body}${att}`;
      })
      .join("\n");

    const wizardBlock = [
      `Wizard answers:`,
      `- Familiarity: ${row.familiarity}`,
      `- Building: ${row.developing}`,
      `- AI tools: ${row.ai_tools_used || "n/a"}`,
      `- Stack tech: ${row.technologies?.join(", ") || "n/a"}`,
    ].join("\n");

    const apiKey = Deno.env.get("OPENAI_API_KEY");
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
                "You read a customer's intake conversation with a bot, plus their wizard answers, " +
                "and write a tight brief for the engineer who is about to join the call. " +
                "Respond with strict JSON only: " +
                "{\"headline\": string, \"summary\": string, \"key_points\": string[], \"next_steps\": string[]}. " +
                "`headline` = 6-10 words, the customer's core ask in plain language. No period. " +
                "`summary` = 2-3 sentences. Lead with what they're building and what's broken. Use the customer's own phrasing. " +
                "`key_points` = 3-6 short bullets the engineer needs in the first 30 seconds (error text verbatim if any, stack, AI tools, environment). " +
                "`next_steps` = 2-4 short imperative items the engineer should consider first. " +
                "Output JSON only, no markdown.",
            },
            {
              role: "user",
              content: `${wizardBlock}\n\nTranscript:\n${transcript}`,
            },
          ],
        }),
      });
      if (ai.ok) {
        const j = await ai.json();
        const raw = j.choices?.[0]?.message?.content?.trim() ?? "{}";
        try {
          const parsed = JSON.parse(raw);
          const parts: string[] = [];
          if (parsed.headline) parts.push(String(parsed.headline));
          if (parsed.summary) parts.push("");
          if (parsed.summary) parts.push(String(parsed.summary));
          if (Array.isArray(parsed.key_points) && parsed.key_points.length) {
            parts.push("");
            parts.push("Key points:");
            for (const p of parsed.key_points) parts.push(`• ${String(p)}`);
          }
          if (Array.isArray(parsed.next_steps) && parsed.next_steps.length) {
            parts.push("");
            parts.push("Next steps:");
            for (const p of parsed.next_steps) parts.push(`• ${String(p)}`);
          }
          summary = parts.join("\n").trim();
          if (!summary) summary = raw;
        } catch {
          summary = raw;
        }
      } else {
        const errText = await ai.text().catch(() => "");
        console.error("[summarize-intake] OpenAI error", ai.status, errText);
        summary = `${wizardBlock}\n\n${transcript.slice(0, 1500)}`;
      }
    } else {
      // No key — fall back to the raw transcript so the tray still has signal.
      summary = `${wizardBlock}\n\n${transcript.slice(0, 1500)}`;
    }

    await supabase
      .from("client_intakes")
      .update({
        intake_summary: summary,
        intake_summary_updated_at: new Date().toISOString(),
      })
      .eq("id", intake_id);

    return new Response(
      JSON.stringify({
        ok: true,
        user_turns: userTurns.length,
        attachments: attachmentCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
