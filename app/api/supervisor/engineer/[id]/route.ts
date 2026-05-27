/*
 * Supervisor drill-in: one engineer's read-only detail, scoped to the
 * caller's pod. Powers the expanded EngineerCard.
 *
 * GET /api/supervisor/engineer/:id
 *   { engineer: { totals, presence }, recentSessions: [...] }
 *
 * Gated: caller must be a supervisor whose pod contains the engineer.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: engineerId } = await params;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Caller's pod, then verify the engineer is in it.
  const { data: myPod } = await admin
    .from("pod_members").select("pod_id").eq("user_id", user.id).eq("pod_role", "supervisor").maybeSingle();
  const podId = (myPod as { pod_id?: string } | null)?.pod_id ?? null;
  if (!podId) return NextResponse.json({ error: "no_pod" }, { status: 403 });

  const { data: membership } = await admin
    .from("pod_members").select("user_id").eq("pod_id", podId).eq("pod_role", "engineer").eq("user_id", engineerId).maybeSingle();
  if (!membership) return NextResponse.json({ error: "not_in_pod" }, { status: 403 });

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const todayStr = new Date().toISOString().slice(0, 10);
  const next14 = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const [{ data: profile }, { data: recent }, { data: kpiRows }, { data: escRows }, { data: winRows }, { data: holRows }, { data: bookRows }] = await Promise.all([
    admin.from("engineer_profiles").select("presence_state, is_available, updated_at").eq("user_id", engineerId).maybeSingle(),
    admin
      .from("guest_calls")
      .select("id, guest_name, status, duration_minutes, created_at, ended_at, project_name")
      .eq("claimed_by", engineerId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("guest_calls")
      .select("duration_minutes, status, ended_at")
      .eq("claimed_by", engineerId)
      .gte("created_at", since30),
    admin
      .from("session_escalations")
      .select("id, reason, note, status, resolution_note, created_at, resolved_at")
      .eq("engineer_user_id", engineerId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("engineer_availability_windows").select("weekday").eq("engineer_user_id", engineerId),
    admin.from("engineer_holidays").select("holiday_date, label, kind").eq("engineer_user_id", engineerId).gte("holiday_date", todayStr).order("holiday_date", { ascending: true }).limit(10),
    admin.from("engineer_bookings").select("slot_start, status").eq("engineer_user_id", engineerId).eq("status", "booked").gte("slot_start", new Date().toISOString()).lt("slot_start", next14).order("slot_start", { ascending: true }).limit(10),
  ]);

  const kpis = (kpiRows ?? []) as { duration_minutes: number | null; status: string; ended_at: string | null }[];
  const buildMinutes = kpis.reduce((s, r) => s + Math.round(Number(r.duration_minutes ?? 0)), 0);
  const ended = kpis.filter((r) => r.ended_at);
  const avgDurationMin = ended.length
    ? Math.round(ended.reduce((s, r) => s + Number(r.duration_minutes ?? 0), 0) / ended.length)
    : 0;
  const pres = profile as { presence_state: string | null; is_available: boolean | null; updated_at: string | null } | null;

  type Esc = { id: string; reason: string; note: string | null; status: string; resolution_note: string | null; created_at: string; resolved_at: string | null };
  const escalations = (escRows ?? []) as Esc[];
  const esc30d = escalations.filter((e) => e.created_at >= since30).length;
  // Escalations per 10 sessions over the 30-day window (D4).
  const escalationRate = kpis.length > 0 ? Math.round((esc30d / kpis.length) * 10 * 10) / 10 : 0;

  return NextResponse.json({
    engineer: {
      presenceState: pres?.presence_state ?? "offline",
      presenceSince: pres?.updated_at ?? null,
      totals: { sessions30d: kpis.length, buildMinutes, avgDurationMin },
      escalations30d: esc30d,
      escalationRate,
    },
    escalations: escalations.map((e) => ({
      id: e.id, reason: e.reason, note: e.note, status: e.status,
      resolutionNote: e.resolution_note, createdAt: e.created_at, resolvedAt: e.resolved_at,
    })),
    availability: {
      weekdays: [...new Set(((winRows ?? []) as { weekday: number }[]).map((w) => w.weekday))].sort(),
      holidays: ((holRows ?? []) as { holiday_date: string; label: string | null; kind: string }[]).map((h) => ({ date: h.holiday_date, label: h.label, kind: h.kind })),
      upcomingBookings: ((bookRows ?? []) as { slot_start: string }[]).map((b) => b.slot_start),
    },
    recentSessions: (recent ?? []).map((r: { id: string; guest_name: string | null; status: string; duration_minutes: number | null; created_at: string; ended_at: string | null; project_name: string | null }) => ({
      id: r.id,
      guestName: r.guest_name,
      status: r.status,
      durationMinutes: r.duration_minutes != null ? Math.round(Number(r.duration_minutes)) : null,
      createdAt: r.created_at,
      endedAt: r.ended_at,
      projectName: r.project_name,
    })),
  });
}
