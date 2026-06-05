/*
 * Pending leave requests raised by ENGINEERS in the supervisor's pod. The
 * supervisor may reject these (decide_leave_request with _approve=false) but
 * not approve them — sign-off is the super-admin's. Supervisor-gated,
 * pod-scoped, names resolved server-side.
 *
 * GET /api/supervisor/leave-requests
 *   { requests: [{ id, engineer, startDate, endDate, totalDays, reason, kind,
 *                  status, createdAt }] }
 *
 * Returns the pod's PENDING + ACCEPTED engineer leave (rejected requests drop
 * off). Pending rows are rejectable by the supervisor; accepted rows are shown
 * as a read-only "Accepted" once the super-admin has signed off.
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
  if (!podId) return NextResponse.json({ requests: [] });

  // Pending + accepted engineer leave for this pod. (Supervisors can't reject
  // other supervisors' leave, so scope to requester_role = 'engineer'.)
  const { data: rows } = await admin
    .from("leave_requests")
    .select(
      "id, requester_user_id, start_date, end_date, total_days, reason, kind, status, created_at"
    )
    .eq("pod_id", podId)
    .eq("requester_role", "engineer")
    .in("status", ["pending", "approved"])
    .order("start_date", { ascending: true })
    .limit(200);
  const reqs = (rows ?? []) as {
    id: string;
    requester_user_id: string;
    start_date: string;
    end_date: string;
    total_days: number;
    reason: string;
    kind: string;
    status: string;
    created_at: string;
  }[];
  if (reqs.length === 0) return NextResponse.json({ requests: [] });

  const userIds = [...new Set(reqs.map((r) => r.requester_user_id))];
  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[])
    if (p.full_name) nameById.set(p.id, p.full_name);

  return NextResponse.json({
    requests: reqs.map((r) => ({
      id: r.id,
      engineer: nameById.get(r.requester_user_id) ?? "Engineer",
      startDate: r.start_date,
      endDate: r.end_date,
      totalDays: r.total_days,
      reason: r.reason,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
}
