/*
 * C2 — bookings org-view for the supervisor's pod. Upcoming engineer_bookings
 * across the pod, with engineer + customer + project names. Filtering by
 * engineer / date happens client-side.
 *
 * GET /api/supervisor/bookings
 *   { bookings: [{ id, engineer, engineerId, customer, project, slotStart,
 *                  slotEnd, status }] }
 *
 * Supervisor-gated, pod-scoped.
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
  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: myPod } = await admin.from("pod_members").select("pod_id").eq("user_id", user.id).eq("pod_role", "supervisor").maybeSingle();
  const podId = (myPod as { pod_id?: string } | null)?.pod_id ?? null;
  let engineerIds: string[] = [];
  if (podId) {
    const { data: members } = await admin.from("pod_members").select("user_id").eq("pod_id", podId).eq("pod_role", "engineer");
    engineerIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  }
  if (engineerIds.length === 0) return NextResponse.json({ bookings: [] });

  // Upcoming + recent (last 2 days) bookings.
  const from = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: rows } = await admin
    .from("engineer_bookings")
    .select("id, engineer_user_id, customer_user_id, project_id, slot_start, slot_end, status")
    .in("engineer_user_id", engineerIds)
    .gte("slot_start", from)
    .order("slot_start", { ascending: true })
    .limit(200);
  const bks = (rows ?? []) as { id: string; engineer_user_id: string; customer_user_id: string; project_id: string | null; slot_start: string; slot_end: string; status: string }[];
  if (bks.length === 0) return NextResponse.json({ bookings: [] });

  const userIds = [...new Set(bks.flatMap((b) => [b.engineer_user_id, b.customer_user_id]))];
  const projIds = [...new Set(bks.map((b) => b.project_id).filter(Boolean) as string[])];
  const [{ data: profs }, { data: projs }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", userIds),
    projIds.length ? admin.from("projects").select("id, name").in("id", projIds) : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) nameById.set(p.id, p.full_name);
  const projById = new Map<string, string>();
  for (const p of (projs ?? []) as { id: string; name: string | null }[]) if (p.name) projById.set(p.id, p.name);

  return NextResponse.json({
    bookings: bks.map((b) => ({
      id: b.id,
      engineer: nameById.get(b.engineer_user_id) ?? "Engineer",
      engineerId: b.engineer_user_id,
      customer: nameById.get(b.customer_user_id) ?? "Customer",
      project: b.project_id ? projById.get(b.project_id) ?? null : null,
      slotStart: b.slot_start,
      slotEnd: b.slot_end,
      status: b.status,
    })),
  });
}
