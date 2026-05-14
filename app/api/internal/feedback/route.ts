/*
 * Org feedback feed. Pulls the latest AI-derived session_health summary
 * per session for sessions belonging to the caller's org, sorted newest
 * first. We surface the sentiment score + one-line summary as
 * "feedback" until a real customer-facing rating widget lands.
 *
 * GET /api/internal/feedback?limit=40
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const url   = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "40", 10) || 40));

  // 1. Find sessions in this org (we filter by engineers belonging to the org).
  const { data: orgUsers } = await admin
    .from("profiles")
    .select("id")
    .eq("organization_id", orgId);
  const userIds = (orgUsers ?? []).map((u: { id: string }) => u.id);
  if (userIds.length === 0) return NextResponse.json({ feedback: [] });

  const { data: sessions } = await admin
    .from("guest_calls")
    .select("id, guest_name, engineer_user_id, created_at")
    .in("engineer_user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(500);
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id);
  if (sessionIds.length === 0) return NextResponse.json({ feedback: [] });

  // 2. Pull latest health row per session via the helper view.
  const { data: health } = await admin
    .from("latest_session_health")
    .select("session_id, score, summary, computed_at")
    .in("session_id", sessionIds)
    .order("computed_at", { ascending: false })
    .limit(limit);

  const sessionById = new Map<string, { guest_name: string | null; engineer_user_id: string | null }>();
  for (const s of (sessions ?? []) as { id: string; guest_name: string | null; engineer_user_id: string | null }[]) {
    sessionById.set(s.id, { guest_name: s.guest_name, engineer_user_id: s.engineer_user_id });
  }

  const engineerNameById = new Map<string, string>();
  const engineerIds = Array.from(new Set((sessions ?? []).map((s: { engineer_user_id: string | null }) => s.engineer_user_id).filter(Boolean) as string[]));
  if (engineerIds.length > 0) {
    const { data: engs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", engineerIds);
    for (const e of (engs ?? []) as { id: string; full_name: string | null }[]) {
      engineerNameById.set(e.id, e.full_name ?? "Unnamed");
    }
  }

  const feedback = (health ?? []).map((h: { session_id: string; score: number; summary: string; computed_at: string }) => {
    const s = sessionById.get(h.session_id);
    return {
      sessionId:    h.session_id,
      score:        Number(h.score),
      summary:      h.summary,
      computedAt:   h.computed_at,
      customerName: s?.guest_name ?? "—",
      engineerName: s?.engineer_user_id ? (engineerNameById.get(s.engineer_user_id) ?? "—") : "—",
    };
  });

  return NextResponse.json({ feedback });
}
