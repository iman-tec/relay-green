/*
 * Enterprise admin: re-send a member's invite email.
 *
 * POST /api/enterprise/members/:id/resend-invite
 *   Re-issues the invite / temp-password email via resendInvitationEmail
 *   (which picks inviteUserByEmail for unconfirmed accounts, otherwise an
 *   OTP magic link). Scoped to the caller's org.
 *
 * Replaces the previous wiring to /api/admin/users/:id/resend-invite,
 * which is super_admin-only and 403'd for enterprise admins.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { resendInvitationEmail } from "@/lib/admin-invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  // Only resend to members of the caller's own org.
  const { data: target } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (
    !target ||
    (target as { organization_id: string | null }).organization_id !== orgId
  ) {
    return NextResponse.json({ error: "not_in_org" }, { status: 404 });
  }

  const r = await resendInvitationEmail(admin, id);
  if (!r.ok) {
    console.warn(`[enterprise/members] resend-invite (${id}): ${r.error}`);
    return NextResponse.json({ error: r.error }, { status: 500 });
  }
  return NextResponse.json({ resent: true });
}
