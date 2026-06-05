/*
 * Enterprise-admin notifications inbox.
 *
 * GET  /api/enterprise/notifications   → 50 latest for the caller + unread.
 * POST /api/enterprise/notifications   → mark all unread as read.
 *
 * Per-USER (notifications.user_id = auth.uid()). Mirror of
 * /api/reseller|department/notifications.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { supabase, user } = gate;

  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; kind: string; title: string; body: string | null; read_at: string | null; created_at: string };
  const items = ((data ?? []) as Row[]).map((n) => ({
    id:        n.id,
    kind:      n.kind,
    title:     n.title,
    body:      n.body,
    readAt:    n.read_at,
    createdAt: n.created_at,
  }));
  const unread = items.filter((i) => i.readAt == null).length;

  return NextResponse.json({ items, unread });
}

export async function POST() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { supabase, user } = gate;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
