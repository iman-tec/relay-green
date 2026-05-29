/*
 * Enterprise org settings — edit name, primary domain, retention window.
 *
 * PATCH /api/enterprise/org
 *   Body: any subset of { name, primaryDomain, retentionDays }
 *   - name           : non-empty after trim
 *   - primaryDomain  : bare host (no @, no path); empty string clears it.
 *                       Must be unique across organizations.
 *   - retentionDays  : 0 or null → "indefinite"; 90 / 180 / 365 → days.
 *                       Stored as int (or NULL for indefinite).
 *
 * The caller's org is resolved from requireEnterpriseAdmin(); we do NOT
 * trust any client-supplied id. RLS would also block cross-org writes;
 * the explicit id filter is defence-in-depth.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const ALLOWED_RETENTION = new Set([0, 90, 180, 365]);

export async function PATCH(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    name?:           string | null;
    primaryDomain?:  string | null;
    retentionDays?:  number | null;
  };

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const next = (body.name ?? "").trim();
    if (next.length === 0) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    update.name = next;
  }

  if (body.primaryDomain !== undefined) {
    const raw = (body.primaryDomain ?? "").trim().toLowerCase();
    if (raw === "") {
      update.primary_domain = null;
    } else if (!DOMAIN.test(raw)) {
      return NextResponse.json({ error: "invalid_domain" }, { status: 400 });
    } else {
      update.primary_domain = raw;
    }
  }

  if (body.retentionDays !== undefined) {
    const n = body.retentionDays;
    if (n !== null && !ALLOWED_RETENTION.has(n)) {
      return NextResponse.json({ error: "invalid_retention" }, { status: 400 });
    }
    // 0 and null both mean "indefinite" — normalise to NULL in storage.
    update.retention_days = n === null || n === 0 ? null : n;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("organizations")
    .update(update)
    .eq("id", orgId)
    .select("id, name, primary_domain, retention_days")
    .single();

  if (error) {
    // 23505 = unique_violation — only primary_domain has UNIQUE so this
    // is unambiguous.
    if (error.code === "23505") {
      return NextResponse.json({ error: "domain_taken" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    org: {
      id:             data.id,
      name:           data.name,
      primaryDomain:  data.primary_domain,
      retentionDays:  data.retention_days ?? 0,
    },
  });
}
