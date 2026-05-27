/*
 * G2 — per-project chat search. Supervisor searches the message history across
 * all of a project's sessions ("what did the customer say about X back in
 * March"). Supervisor-gated; matches guest_messages.body via ILIKE.
 *
 * GET /api/supervisor/chat-search?projectId=<uuid>&q=<text>
 *   { results: [{ sessionId, senderName, senderKind, body, createdAt }] }
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(req: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data: roleRows } = await supabase.from("user_role_names").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes(ROLE.supervisor) && !roles.includes(ROLE.super_admin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const projectId = sp.get("projectId");
  const q = (sp.get("q") ?? "").trim();
  if (!projectId || q.length < 2) return NextResponse.json({ results: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: calls } = await admin.from("guest_calls").select("id").eq("project_id", projectId);
  const callIds = (calls ?? []).map((c: { id: string }) => c.id);
  if (callIds.length === 0) return NextResponse.json({ results: [] });

  // Escape ILIKE wildcards in the user's query.
  const safe = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const { data: msgs } = await admin
    .from("guest_messages")
    .select("guest_call_id, sender_kind, sender_name, body, created_at")
    .in("guest_call_id", callIds)
    .ilike("body", `%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({
    results: ((msgs ?? []) as { guest_call_id: string; sender_kind: string; sender_name: string | null; body: string; created_at: string }[]).map((m) => ({
      sessionId: m.guest_call_id,
      senderName: m.sender_name,
      senderKind: m.sender_kind,
      body: m.body,
      createdAt: m.created_at,
    })),
  });
}
