/*
 * Reseller notifications inbox.
 *
 * GET  /api/reseller/notifications      → 50 latest notifications for the
 *                                          caller (auth.uid()) + unread count.
 * POST /api/reseller/notifications      → Mark all unread as read.
 *
 * Scoped per-USER, not per-RESELLER: each team member (once we add them)
 * has their own inbox. We reuse public.notifications + its RLS
 * (user_id = auth.uid()), so cross-user reads are prevented at the DB
 * layer even though we use the cookie-bound client.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireReseller();
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
  const gate = await requireReseller();
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
