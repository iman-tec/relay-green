/*
 * D5 — recurring escalation themes. Clusters the reason + resolution-note text
 * of the pod's recent escalations into themes ("5 escalated for Stripe in 30
 * days") via an LLM. Ships behind clear states: insufficient data, no LLM key,
 * or computed themes. The OpenAI key stays server-side.
 *
 * GET /api/supervisor/escalation-themes
 *   { state: "ok"|"insufficient"|"unavailable", sampleSize, themes:[{theme,count}] }
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_FOR_THEMES = 5; // below this, not enough signal to cluster

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: "service_role_not_configured" },
      { status: 500 }
    );
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: myPod } = await admin
    .from("pod_members")
    .select("pod_id")
    .eq("user_id", user.id)
    .eq("pod_role", "supervisor")
    .maybeSingle();
  const podId = (myPod as { pod_id?: string } | null)?.pod_id ?? null;
  let engineerIds: string[] = [];
  if (podId) {
    const { data: members } = await admin
      .from("pod_members")
      .select("user_id")
      .eq("pod_id", podId)
      .eq("pod_role", "engineer");
    engineerIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  }
  if (engineerIds.length === 0)
    return NextResponse.json({
      state: "insufficient",
      sampleSize: 0,
      themes: [],
    });

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: escs } = await admin
    .from("session_escalations")
    .select("reason, note, resolution_note")
    .in("engineer_user_id", engineerIds)
    .gte("created_at", since30)
    .limit(200);
  const rows = (escs ?? []) as {
    reason: string;
    note: string | null;
    resolution_note: string | null;
  }[];

  if (rows.length < MIN_FOR_THEMES) {
    return NextResponse.json({
      state: "insufficient",
      sampleSize: rows.length,
      themes: [],
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return NextResponse.json({
      state: "unavailable",
      sampleSize: rows.length,
      themes: [],
    });

  const lines = rows
    .map(
      (r, i) =>
        `${i + 1}. reason="${r.reason}"${r.note ? ` note="${r.note}"` : ""}${r.resolution_note ? ` resolution="${r.resolution_note}"` : ""}`
    )
    .join("\n");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You cluster support-escalation notes into recurring themes. Return JSON: {"themes":[{"theme":"short label","count":N}]}. Only themes with count>=2, sorted by count desc, max 6. Theme labels are 1-4 words (e.g. "Stripe payments", "Zoom join failures").',
          },
          { role: "user", content: `Escalations (last 30 days):\n${lines}` },
        ],
      }),
    });
    if (!res.ok)
      return NextResponse.json({
        state: "unavailable",
        sampleSize: rows.length,
        themes: [],
      });
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as {
      themes?: { theme: string; count: number }[];
    };
    const themes = (parsed.themes ?? [])
      .filter((t) => t.theme && t.count >= 2)
      .slice(0, 6);
    return NextResponse.json({ state: "ok", sampleSize: rows.length, themes });
  } catch {
    return NextResponse.json({
      state: "unavailable",
      sampleSize: rows.length,
      themes: [],
    });
  }
}
