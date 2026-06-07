/*
 * Enterprise MSA acceptance — the org-level terms gate (distinct from the
 * Channel-Partner clickwrap at /api/enterprise/accept-terms).
 *
 * GET  → { needsAcceptance, version, acceptedAt }
 *   needsAcceptance is true when no acceptance exists for the CURRENT version.
 *   Resilient: if the terms_type column isn't applied yet, returns
 *   needsAcceptance=false so the console never hard-blocks pre-migration.
 *
 * POST → records an org-scoped acceptance (signer attests authority) with
 *   version + sha256 + IP + UA, terms_type='enterprise_msa'. Idempotent-ish:
 *   re-accepting the same version just appends (the contract of record).
 *
 * Caller must be an enterprise_admin.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import {
  ENTERPRISE_MSA_VERSION,
  ENTERPRISE_MSA_STATEMENT,
} from "@/lib/enterpriseTerms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data, error } = await admin
    .from("terms_acceptances")
    .select("accepted_at")
    .eq("enterprise_id", orgId)
    .eq("terms_type", "enterprise_msa")
    .eq("terms_version", ENTERPRISE_MSA_VERSION)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Column/table not present yet (pre-migration) → don't block the console.
  if (error) {
    return NextResponse.json({
      needsAcceptance: false,
      version: ENTERPRISE_MSA_VERSION,
      acceptedAt: null,
    });
  }

  const acceptedAt =
    (data as { accepted_at?: string } | null)?.accepted_at ?? null;
  return NextResponse.json({
    needsAcceptance: !acceptedAt,
    version: ENTERPRISE_MSA_VERSION,
    acceptedAt,
  });
}

export async function POST(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId, user } = gate;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent");
  const termsSha256 = createHash("sha256")
    .update(ENTERPRISE_MSA_STATEMENT)
    .digest("hex");

  const { error } = await admin.from("terms_acceptances").insert({
    enterprise_id: orgId,
    admin_user_id: user.id,
    terms_type: "enterprise_msa",
    terms_version: ENTERPRISE_MSA_VERSION,
    terms_sha256: termsSha256,
    ip,
    user_agent: userAgent,
  });
  if (error) {
    return NextResponse.json(
      { error: "Couldn't record acceptance. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, version: ENTERPRISE_MSA_VERSION });
}
