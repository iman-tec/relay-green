/*
 * PATCH  /api/invite/:id  → resend (re-email + bump sent_at, back to 'sent')
 * DELETE /api/invite/:id  → revoke (status = 'revoked')
 *
 * Scoped: the caller may only act on invites they created (invited_by).
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendInvitationEmail } from "@/lib/admin-invite";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function gate(id: string) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "not_signed_in" };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false as const, status: 500, error: "service_role_not_configured" };
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: inv } = await admin
    .from("invites")
    .select("id, email, name, role, status, invited_by")
    .eq("id", id)
    .maybeSingle();
  const row = inv as { id: string; email: string; name: string | null; role: string | null; status: string; invited_by: string } | null;
  if (!row) return { ok: false as const, status: 404, error: "not_found" };
  if (row.invited_by !== user.id) return { ok: false as const, status: 403, error: "not_owned" };
  return { ok: true as const, admin, row };
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await gate(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { error } = await g.admin.from("invites").update({ status: "revoked" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await gate(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  if (g.row.status === "accepted") return NextResponse.json({ error: "Already accepted." }, { status: 400 });
  await sendInvitationEmail(g.admin, {
    email: g.row.email,
    displayName: g.row.name ?? g.row.email.split("@")[0],
    metadata: { invite_role: g.row.role ?? "client" },
  });
  const { error } = await g.admin
    .from("invites")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
