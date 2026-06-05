/*
 * Enterprise data export — GDPR Article 20 (portability).
 *
 * POST /api/enterprise/export
 *   Bundles the org's portable data into a single .zip of CSVs:
 *
 *     organization.csv  — org metadata (one row)
 *     departments.csv   — every department in the org
 *     members.csv       — every profile linked to the org
 *     sessions.csv      — every guest_call attributed to the org
 *     usage.csv         — per-member rollup (sessions + minutes)
 *     billing.csv       — plan snapshot + derived revenue figures
 *
 *  The download is synchronous (no queue, no email). Scope is the
 *  caller's org via requireEnterpriseAdmin(); RLS would block any
 *  cross-org reads even though we use the service-role client here.
 *
 *  Out of scope (intentionally): customer messages (engineer ↔ user
 *  chat), AI summaries, attachments. Those are governed by the
 *  retention sweeper, not the portability export.
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";
import { buildZip, toCsv, type ZipEntry } from "@/lib/relay/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CENTS_PER_MINUTE = 300; // mirror of /api/enterprise/billing

export async function POST() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  // ---- Organisation row ----
  type OrgRow = {
    id: string;
    name: string;
    primary_domain: string | null;
    status: string;
    enterprise_code: string;
    created_at: string;
    plan_tier: string | null;
    plan_status: string | null;
    retention_days: number | null;
    reseller_id: string | null;
  };
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select(
      "id, name, primary_domain, status, enterprise_code, created_at, plan_tier, plan_status, retention_days, reseller_id"
    )
    .eq("id", orgId)
    .single<OrgRow>();
  if (orgErr || !orgRow) {
    return NextResponse.json(
      { error: orgErr?.message ?? "Org not found." },
      { status: 404 }
    );
  }

  // ---- Departments ----
  type DeptRow = {
    id: string;
    name: string;
    status: string;
    created_at: string;
  };
  const { data: deptRows } = await admin
    .from("departments")
    .select("id, name, status, created_at")
    .eq("enterprise_id", orgId)
    .order("created_at", { ascending: true })
    .returns<DeptRow[]>();
  const departments = deptRows ?? [];

  // ---- Members (profiles in this org) + their email from auth.users ----
  type ProfileRow = {
    id: string;
    full_name: string | null;
    status: string | null;
    department_id: string | null;
    created_at: string;
    erased_at: string | null;
  };
  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, full_name, status, department_id, created_at, erased_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .returns<ProfileRow[]>();
  const profiles = profileRows ?? [];

  // Resolve emails from auth.users (one paged call covers org sizes well
  // under the seat caps we target). Filter to the profile ids we already have.
  const emailById = new Map<string, string>();
  if (profiles.length > 0) {
    try {
      const { data } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      for (const u of data?.users ?? []) {
        emailById.set(u.id, u.email ?? "");
      }
    } catch {
      /* Best-effort. Missing emails appear blank in members.csv. */
    }
  }

  // ---- Sessions (guest_calls scoped to the org) ----
  // Engineer identity is intentionally NOT exported — the engineer is a
  // Relay-side resource, not the org's own data (GDPR minimisation), and
  // guest_calls has no engineer_user_id column anyway.
  type CallRow = {
    id: string;
    status: string;
    created_at: string;
    duration_minutes: number | null;
    customer_user_id: string | null;
    organization_id: string | null;
  };
  const profileIds = profiles.map((p) => p.id);
  const orFilter =
    profileIds.length > 0
      ? `organization_id.eq.${orgId},customer_user_id.in.(${profileIds.join(",")})`
      : `organization_id.eq.${orgId}`;
  const { data: callRows } = await admin
    .from("guest_calls")
    .select(
      "id, status, created_at, duration_minutes, customer_user_id, organization_id"
    )
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(10_000)
    .returns<CallRow[]>();
  const sessions = callRows ?? [];

  // ---- Per-member usage rollup ----
  const usageByMember = new Map<
    string,
    { sessions: number; minutes: number; spendCents: number }
  >();
  for (const s of sessions) {
    if (!s.customer_user_id) continue;
    const u = usageByMember.get(s.customer_user_id) ?? {
      sessions: 0,
      minutes: 0,
      spendCents: 0,
    };
    u.sessions += 1;
    const dur = Number(s.duration_minutes ?? 0);
    u.minutes += dur;
    u.spendCents += Math.round(dur * CENTS_PER_MINUTE);
    usageByMember.set(s.customer_user_id, u);
  }

  // ---- Build CSVs ----
  const orgCsv = toCsv(
    [
      "id",
      "name",
      "primary_domain",
      "status",
      "enterprise_code",
      "created_at",
      "plan_tier",
      "plan_status",
      "retention_days",
      "reseller_id",
    ],
    [
      [
        orgRow.id,
        orgRow.name,
        orgRow.primary_domain ?? "",
        orgRow.status,
        orgRow.enterprise_code,
        orgRow.created_at,
        orgRow.plan_tier ?? "",
        orgRow.plan_status ?? "",
        orgRow.retention_days ?? "",
        orgRow.reseller_id ?? "",
      ],
    ]
  );

  const deptCsv = toCsv(
    ["id", "name", "status", "created_at"],
    departments.map((d) => [d.id, d.name, d.status, d.created_at])
  );

  const membersCsv = toCsv(
    [
      "id",
      "email",
      "full_name",
      "status",
      "department_id",
      "created_at",
      "erased_at",
    ],
    profiles.map((p) => [
      p.id,
      emailById.get(p.id) ?? "",
      // Honour the erasure marker even in exports.
      p.erased_at ? "" : (p.full_name ?? ""),
      p.status ?? "",
      p.department_id ?? "",
      p.created_at,
      p.erased_at ?? "",
    ])
  );

  const sessionsCsv = toCsv(
    [
      "id",
      "status",
      "created_at",
      "duration_minutes",
      "customer_user_id",
      "organization_id",
    ],
    sessions.map((s) => [
      s.id,
      s.status,
      s.created_at,
      s.duration_minutes ?? 0,
      s.customer_user_id ?? "",
      s.organization_id ?? "",
    ])
  );

  const usageCsv = toCsv(
    ["member_id", "email", "full_name", "sessions", "minutes", "spend_cents"],
    Array.from(usageByMember.entries()).map(([userId, u]) => {
      const p = profiles.find((x) => x.id === userId);
      return [
        userId,
        emailById.get(userId) ?? "",
        p && !p.erased_at ? (p.full_name ?? "") : "",
        u.sessions,
        u.minutes,
        u.spendCents,
      ];
    })
  );

  // Billing snapshot — plan fields + derived revenue. We avoid hitting
  // /api/enterprise/billing to keep the export self-contained.
  let revenueLifetime = 0;
  let revenue30 = 0;
  const now = Date.now();
  const cut30 = now - 30 * 86_400_000;
  for (const s of sessions) {
    if (s.status !== "ended" || !s.duration_minutes) continue;
    const cents = Math.round(Number(s.duration_minutes) * CENTS_PER_MINUTE);
    revenueLifetime += cents;
    if (new Date(s.created_at).getTime() >= cut30) revenue30 += cents;
  }
  const billingCsv = toCsv(
    ["metric", "value"],
    [
      ["plan_tier", orgRow.plan_tier ?? ""],
      ["plan_status", orgRow.plan_status ?? ""],
      ["revenue_last_30_days_cents", revenue30],
      ["revenue_lifetime_cents", revenueLifetime],
      ["per_minute_rate_cents", CENTS_PER_MINUTE],
    ]
  );

  const entries: ZipEntry[] = [
    { name: "organization.csv", data: orgCsv },
    { name: "departments.csv", data: deptCsv },
    { name: "members.csv", data: membersCsv },
    { name: "sessions.csv", data: sessionsCsv },
    { name: "usage.csv", data: usageCsv },
    { name: "billing.csv", data: billingCsv },
  ];
  const zip = buildZip(entries);

  // Filename: "<orgname>-export-<YYYYMMDD>.zip". Replace anything risky in
  // the org name with underscores so the Content-Disposition stays valid.
  const safeName =
    orgRow.name.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") ||
    "organization";
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `${safeName}-export-${today}.zip`;

  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
