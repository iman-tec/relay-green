/*
 * E3 — pod payouts overview. Pod-level payout totals + per-engineer breakdown,
 * matching the engineer's own Payouts tab (engineer_earnings_summary view).
 * Supervisor-gated, pod-scoped.
 *
 * GET /api/supervisor/payouts
 *   { total: { earningsCents, billableMinutes, sessions },
 *     engineers: [{ name, earningsCents, billableMinutes, sessions, lastSessionAt }] }
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      total: { earningsCents: 0, billableMinutes: 0, sessions: 0 },
      engineers: [],
    });

  const [{ data: earn }, { data: profs }] = await Promise.all([
    admin
      .from("engineer_earnings_summary")
      .select(
        "engineer_user_id, total_sessions, billable_minutes, lifetime_earnings_cents, most_recent_session_at"
      )
      .in("engineer_user_id", engineerIds),
    admin.from("profiles").select("id, full_name").in("id", engineerIds),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[])
    if (p.full_name) nameById.set(p.id, p.full_name);

  type E = {
    engineer_user_id: string;
    total_sessions: number;
    billable_minutes: number;
    lifetime_earnings_cents: number | null;
    most_recent_session_at: string | null;
  };
  const rows = (earn ?? []) as E[];
  const engineers = rows
    .map((e) => ({
      name: nameById.get(e.engineer_user_id) ?? "Engineer",
      earningsCents: Number(e.lifetime_earnings_cents ?? 0),
      billableMinutes: Number(e.billable_minutes ?? 0),
      sessions: Number(e.total_sessions ?? 0),
      lastSessionAt: e.most_recent_session_at,
    }))
    .sort((a, b) => b.earningsCents - a.earningsCents);

  const total = engineers.reduce(
    (t, e) => ({
      earningsCents: t.earningsCents + e.earningsCents,
      billableMinutes: t.billableMinutes + e.billableMinutes,
      sessions: t.sessions + e.sessions,
    }),
    { earningsCents: 0, billableMinutes: 0, sessions: 0 }
  );

  return NextResponse.json({ total, engineers });
}
