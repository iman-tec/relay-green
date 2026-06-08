/*
 * POST /api/reseller/enterprises/:id/resend-invite
 *   Re-send the onboarding invite to a company the partner provisioned (for
 *   invited-not-accepted orgs). Resolves the org's enterprise_admin and reuses
 *   resendInvitationEmail. Scoped: the org must belong to the caller's reseller.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { resendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { id: orgId } = await params;
  const { data: org } = await admin
    .from("organizations")
    .select("id, reseller_id")
    .eq("id", orgId)
    .maybeSingle();
  if (
    !org ||
    (org as { reseller_id: string | null }).reseller_id !== resellerId
  ) {
    return NextResponse.json({ error: "not_your_client" }, { status: 404 });
  }

  // The org's enterprise_admin (the person invited at onboard).
  const { data: prof } = await admin
    .from("profiles_with_role")
    .select("id, primary_role")
    .eq("organization_id", orgId)
    .eq("primary_role", ROLE.enterprise_admin)
    .limit(1)
    .maybeSingle();
  const adminUserId = (prof as { id: string } | null)?.id;
  if (!adminUserId) {
    return NextResponse.json(
      { error: "No admin to re-invite for this company." },
      { status: 404 }
    );
  }

  const res = await resendInvitationEmail(admin, adminUserId);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
