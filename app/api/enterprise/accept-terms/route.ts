/*
 * Channel Partner clickwrap acceptance.
 *
 * GET  /api/enterprise/accept-terms
 *   → { needsAcceptance, partnerStatus, termsVersion }
 *   The enterprise console's clickwrap gate calls this to decide whether to
 *   block the portal. needsAcceptance is true only for a partner-onboarded org
 *   still in 'invited' (i.e. the admin hasn't agreed yet).
 *
 * POST /api/enterprise/accept-terms
 *   The affirmative "I Agree". Writes the contract of record
 *   (terms_acceptances: identity + timestamp + IP + version + hash of the exact
 *   statement shown) and flips organizations.partner_status → 'active'.
 *   Idempotent: a second POST on an already-active org is a no-op success.
 *
 * Only operates on partner-onboarded orgs (partner_status set). For a normal
 * (organic / non-partner) enterprise this is a 400 — there's no contract to
 * accept and no spurious rows get created.
 *
 * Caller must be an enterprise_admin with a profiles.organization_id.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import {
  PARTNER_TERMS_VERSION,
  PARTNER_TERMS_STATEMENT,
} from "@/lib/billing/partnerTerms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrgPartner = { partner_status: string | null };

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data } = await admin
    .from("organizations")
    .select("partner_status")
    .eq("id", orgId)
    .maybeSingle();
  const partnerStatus = (data as OrgPartner | null)?.partner_status ?? null;

  return NextResponse.json({
    needsAcceptance: partnerStatus === "invited",
    partnerStatus,
    termsVersion: PARTNER_TERMS_VERSION,
  });
}

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user } = gate;

  const { data: orgRow } = await admin
    .from("organizations")
    .select("partner_status")
    .eq("id", orgId)
    .maybeSingle();
  const partnerStatus = (orgRow as OrgPartner | null)?.partner_status ?? null;

  // Not a partner-onboarded org → nothing to accept.
  if (partnerStatus === null) {
    return NextResponse.json(
      { error: "This organization has no partner terms to accept." },
      { status: 400 }
    );
  }
  // Already accepted (or paused) → idempotent success, don't double-record.
  if (partnerStatus !== "invited") {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent");
  const termsSha256 = createHash("sha256")
    .update(PARTNER_TERMS_STATEMENT)
    .digest("hex");

  const { error: insErr } = await admin.from("terms_acceptances").insert({
    enterprise_id: orgId,
    admin_user_id: user.id,
    terms_version: PARTNER_TERMS_VERSION,
    terms_sha256: termsSha256,
    ip,
    user_agent: userAgent,
  });
  if (insErr) {
    return NextResponse.json(
      { error: "Couldn't record acceptance. Please try again." },
      { status: 500 }
    );
  }

  // Flip to active. Guard on the current state so a concurrent double-submit
  // only transitions once.
  const { error: updErr } = await admin
    .from("organizations")
    .update({ partner_status: "active" })
    .eq("id", orgId)
    .eq("partner_status", "invited");
  if (updErr) {
    return NextResponse.json(
      { error: "Acceptance recorded but activation failed. Refresh to retry." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, termsVersion: PARTNER_TERMS_VERSION });
}
