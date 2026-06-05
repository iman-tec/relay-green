/*
 * Engineer / staff notification inbox — feeds the dashboard bell.
 *
 * Scoped to the four event kinds the dashboard surfaces:
 *   call_scheduled · call_rescheduled · leave_accepted · leave_rejected
 *
 * GET  /api/engineer/notifications  → 50 latest of those kinds + unread count.
 * POST /api/engineer/notifications  → mark all unread (of those kinds) read.
 *
 * Per-user via public.notifications RLS (user_id = auth.uid()).
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const NOTIFICATION_KINDS = [
  "call_scheduled",
  "call_rescheduled",
  "leave_accepted",
  "leave_rejected",
] as const;

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, read_at, created_at")
    .eq("user_id", user.id)
    .in("kind", NOTIFICATION_KINDS as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(50);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    read_at: string | null;
    created_at: string;
  };
  const items = ((data ?? []) as Row[]).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
  const unread = items.filter((i) => i.readAt == null).length;

  return NextResponse.json({ items, unread });
}

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in("kind", NOTIFICATION_KINDS as unknown as string[])
    .is("read_at", null);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Clear all — removes every notification of these kinds for the caller.
export async function DELETE() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("user_id", user.id)
    .in("kind", NOTIFICATION_KINDS as unknown as string[]);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
