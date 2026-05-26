// Intake-transcript summary. Reads the bot↔customer transcript captured in
// client_intakes.intake_messages plus the structured wizard fields, asks an
// LLM for a tight engineer-ready brief, and writes it back to
// client_intakes.intake_summary.
//
// Also extracts three structured signals the matcher reads
// (20260527120000_match_engineer_v2.sql):
//   - issues        text[]   what's broken (e.g. 'memory-leak', 'auth-flow')
//   - environments  text[]   stack/OS/framework (e.g. 'next.js', 'macos')
//   - urgency       text     'urgent' | 'standard' | 'later'
//
// Invoked from the customer's MatchingClient the moment an engineer accepts
// (before redirecting to /room). Safe to call directly with { intake_id }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Sanitize a list of free-text tags from the LLM: lowercase, trim, dedupe,
// drop empties, cap at 8 items, cap each at 40 chars. Matches the shape the
// matcher's set-intersection expects.
function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const clean = item.trim().toLowerCase().slice(0, 40);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeUrgency(raw: unknown): "urgent" | "standard" | "later" {
  if (raw === "urgent" || raw === "later") return raw;
  return "standard";
}

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
    let issues: string[] = [];
    let environments: string[] = [];
    let urgency: "urgent" | "standard" | "later" = "standard";

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
                "{\"headline\": string, \"summary\": string, \"key_points\": string[], \"next_steps\": string[], " +
                "\"issues\": string[], \"environments\": string[], \"urgency\": \"urgent\" | \"standard\" | \"later\"}. " +
                "`headline` = 6-10 words, the customer's core ask in plain language. No period. " +
                "`summary` = 2-3 sentences. Lead with what they're building and what's broken. Use the customer's own phrasing. " +
                "`key_points` = 3-6 short bullets the engineer needs in the first 30 seconds (error text verbatim if any, stack, AI tools, environment). " +
                "`next_steps` = 2-4 short imperative items the engineer should consider first. " +
                "`issues` = up to 6 short lowercase-kebab tags describing what's broken (e.g. 'memory-leak', 'auth-loop', 'build-fail', 'dependency-conflict'). Use the same canonical kebab tags engineers self-declare. Empty array if unclear. " +
                "`environments` = up to 6 short lowercase tags for stack/OS/framework (e.g. 'next.js', 'react-native', 'macos', 'node-20', 'docker'). Empty array if unclear. " +
                "`urgency` = 'urgent' if blocking production / customer demo / clock is ticking; 'later' if exploratory / refactor / learn; otherwise 'standard'. " +
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
          // Matcher signals (best-effort; tolerant of missing or malformed fields).
          issues       = sanitizeTags(parsed.issues);
          environments = sanitizeTags(parsed.environments);
          urgency      = sanitizeUrgency(parsed.urgency);
        } catch {
          summary = raw;
          // Leave issues/environments/urgency at their defaults so the DB row
          // keeps its current values (the UPDATE below only writes if non-empty).
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

    // Write summary + matcher signals together. Only set issues/environments
    // when the LLM gave us something — empty arrays from a failed parse would
    // clobber any prior good extraction.
    const update: Record<string, unknown> = {
      intake_summary: summary,
      intake_summary_updated_at: new Date().toISOString(),
      urgency,
    };
    if (issues.length)       update.issues       = issues;
    if (environments.length) update.environments = environments;

    await supabase
      .from("client_intakes")
      .update(update)
      .eq("id", intake_id);

    return new Response(
      JSON.stringify({
        ok: true,
        user_turns: userTurns.length,
        attachments: attachmentCount,
        issues_extracted: issues.length,
        environments_extracted: environments.length,
        urgency,
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
