/*
 * POST /api/admin/users/:id/resend-invite
 *
 * Re-issues the invite / magic-link email for an existing user. The
 * heavy lifting is in lib/admin-invite — picks inviteUserByEmail for
 * unconfirmed accounts, falls back to signInWithOtp (magic link) for
 * confirmed ones, and surfaces SMTP / rate-limit errors back to the UI.
 *
 * Caller must hold super_admin.
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { resendInvitationEmail } from "@/lib/admin-invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { admin } = gate;
  const { id } = await params;

  const r = await resendInvitationEmail(admin, id);
  if (!r.ok) {
    console.warn(`[admin/users] resend-invite (${id}): ${r.error}`);
    return NextResponse.json({ error: r.error }, { status: 500 });
  }

  console.log(`[admin/users] re-sent invite (${r.mode}) to user ${id}`);
  return NextResponse.json({ resent: true });
}
