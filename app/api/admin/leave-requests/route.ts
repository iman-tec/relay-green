/*
 * Super-admin inbox for self-submitted leave requests — pending requests with
 * the requester's name, role, pod, dates, total days and reason. super_admin
 * only. Approve / reject happens client-side via the decide_leave_request RPC.
 *
 * GET /api/admin/leave-requests
 *   { requests: [{ id, requester, role, pod, startDate, endDate, totalDays,
 *                  reason, kind, createdAt }] }
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data: roleRows } = await supabase.from("user_role_names").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.includes(ROLE.super_admin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: reqs } = await admin
    .from("leave_requests")
    .select("id, requester_user_id, requester_role, pod_id, start_date, end_date, total_days, reason, kind, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  const rows = (reqs ?? []) as {
    id: string; requester_user_id: string; requester_role: string; pod_id: string | null;
    start_date: string; end_date: string; total_days: number; reason: string; kind: string; created_at: string;
  }[];
  if (rows.length === 0) return NextResponse.json({ requests: [] });

  const userIds = [...new Set(rows.map((r) => r.requester_user_id))];
  const podIds = [...new Set(rows.map((r) => r.pod_id).filter(Boolean) as string[])];
  const [{ data: profs }, { data: pods }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", userIds),
    podIds.length ? admin.from("pods").select("id, name").in("id", podIds) : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) nameById.set(p.id, p.full_name);
  const podById = new Map<string, string>();
  for (const p of (pods ?? []) as { id: string; name: string }[]) podById.set(p.id, p.name);

  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      requester: nameById.get(r.requester_user_id) ?? (r.requester_role === "supervisor" ? "Supervisor" : "Engineer"),
      role: r.requester_role,
      pod: r.pod_id ? podById.get(r.pod_id) ?? null : null,
      startDate: r.start_date,
      endDate: r.end_date,
      totalDays: r.total_days,
      reason: r.reason,
      kind: r.kind,
      createdAt: r.created_at,
    })),
  });
}
