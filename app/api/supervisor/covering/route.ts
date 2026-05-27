/*
 * H1 — who's covering. Lists supervisors with their on-duty (presence) state
 * so co-supervisors can see who has the watch. Supervisor/super_admin only.
 *
 * GET /api/supervisor/covering
 *   { supervisors: [{ name, isOnline }] }
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
  if (!roles.includes(ROLE.supervisor) && !roles.includes(ROLE.super_admin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: roleNames } = await admin.from("user_role_names").select("user_id, role").eq("role", ROLE.supervisor);
  const supIds = [...new Set((roleNames ?? []).map((r: { user_id: string }) => r.user_id))];
  if (supIds.length === 0) return NextResponse.json({ supervisors: [] });

  const [{ data: profs }, { data: pres }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", supIds),
    admin.from("supervisor_presence").select("user_id, is_online").in("user_id", supIds),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) nameById.set(p.id, p.full_name ?? "Supervisor");
  const onlineById = new Map<string, boolean>();
  for (const p of (pres ?? []) as { user_id: string; is_online: boolean }[]) onlineById.set(p.user_id, p.is_online);

  const supervisors = supIds
    .map((id) => ({ name: nameById.get(id) ?? "Supervisor", isOnline: onlineById.get(id) ?? false }))
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.name.localeCompare(b.name));

  return NextResponse.json({ supervisors });
}
