/*
 * Super-admin inbox for the availability/leave relay — open requests raised by
 * supervisors, with engineer + raiser names. super_admin only. Resolve happens
 * client-side via the resolve_availability_request RPC.
 *
 * GET /api/admin/availability-requests
 *   { requests: [{ id, engineer, raisedBy, pod, kind, detail, createdAt }] }
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
  if (!roles.includes(ROLE.super_admin)) {
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

  const { data: reqs } = await admin
    .from("availability_change_requests")
    .select("id, raised_by, engineer_user_id, pod_id, kind, detail, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = (reqs ?? []) as {
    id: string;
    raised_by: string;
    engineer_user_id: string;
    pod_id: string | null;
    kind: string;
    detail: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return NextResponse.json({ requests: [] });

  const userIds = [
    ...new Set(rows.flatMap((r) => [r.raised_by, r.engineer_user_id])),
  ];
  const podIds = [
    ...new Set(rows.map((r) => r.pod_id).filter(Boolean) as string[]),
  ];
  const [{ data: profs }, { data: pods }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", userIds),
    podIds.length
      ? admin.from("pods").select("id, name").in("id", podIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[])
    if (p.full_name) nameById.set(p.id, p.full_name);
  const podById = new Map<string, string>();
  for (const p of (pods ?? []) as { id: string; name: string }[])
    podById.set(p.id, p.name);

  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      engineer: nameById.get(r.engineer_user_id) ?? "Engineer",
      raisedBy: nameById.get(r.raised_by) ?? "Supervisor",
      pod: r.pod_id ? (podById.get(r.pod_id) ?? null) : null,
      kind: r.kind,
      detail: r.detail,
      createdAt: r.created_at,
    })),
  });
}
