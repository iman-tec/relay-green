/*
 * H2 — escalations that fell through to ops. Open session_escalations stamped
 * with ops_escalated_at (no supervisor ack within the window). Shown to the
 * super-admin so nothing goes unsupervised. super_admin only.
 *
 * GET /api/admin/ops-escalations
 *   { escalations: [{ id, sessionId, engineer, customer, reason, note,
 *                     createdAt, opsEscalatedAt }] }
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
  if (!roles.includes(ROLE.super_admin))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

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

  const { data: rows } = await admin
    .from("session_escalations")
    .select(
      "id, session_id, engineer_user_id, reason, note, created_at, ops_escalated_at"
    )
    .eq("status", "open")
    .not("ops_escalated_at", "is", null)
    .order("ops_escalated_at", { ascending: true })
    .limit(50);
  const escs = (rows ?? []) as {
    id: string;
    session_id: string;
    engineer_user_id: string;
    reason: string;
    note: string | null;
    created_at: string;
    ops_escalated_at: string;
  }[];
  if (escs.length === 0) return NextResponse.json({ escalations: [] });

  const engIds = [...new Set(escs.map((e) => e.engineer_user_id))];
  const sessIds = [...new Set(escs.map((e) => e.session_id))];
  const [{ data: profs }, { data: sess }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", engIds),
    admin.from("guest_calls").select("id, guest_name").in("id", sessIds),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[])
    if (p.full_name) nameById.set(p.id, p.full_name);
  const custBySession = new Map<string, string>();
  for (const s of (sess ?? []) as { id: string; guest_name: string | null }[])
    if (s.guest_name) custBySession.set(s.id, s.guest_name);

  return NextResponse.json({
    escalations: escs.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      engineer: nameById.get(e.engineer_user_id) ?? "Engineer",
      customer: custBySession.get(e.session_id) ?? "Customer",
      reason: e.reason,
      note: e.note,
      createdAt: e.created_at,
      opsEscalatedAt: e.ops_escalated_at,
    })),
  });
}
