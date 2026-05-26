/*
 * GET /api/department/sessions?limit=50
 *
 * Sessions for the caller's department only (members of that department),
 * PII-minimized: no customer email, no AI summary content. Scoped via
 * requireDepartmentAdmin (department resolved from the caller's own profile).
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const CENTS_PER_MINUTE = 300;

export async function GET(request: Request) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);

  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("department_id", departmentId);
  const ids = ((profs ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => p.id);
  const nameById = new Map(
    ((profs ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name ?? ""]),
  );
  if (ids.length === 0) return NextResponse.json({ sessions: [] });

  const { data: rows, error } = await admin
    .from("guest_calls")
    .select("id, status, urgency, created_at, joined_at, ended_at, duration_minutes, customer_user_id, project_name")
    .in("customer_user_id", ids)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sessions = ((rows ?? []) as Array<{
    id: string; status: string; urgency: string | null; created_at: string;
    joined_at: string | null; ended_at: string | null; duration_minutes: number | null;
    customer_user_id: string | null; project_name: string | null;
  }>).map((r) => ({
    id: r.id,
    status: r.status,
    urgency: r.urgency ?? "normal",
    createdAt: r.created_at,
    durationMinutes: r.duration_minutes,
    chargeCents: r.duration_minutes ? Math.round(Number(r.duration_minutes) * CENTS_PER_MINUTE) : null,
    memberName: nameById.get(r.customer_user_id ?? "") || "",  // own-dept member — allowed
    projectName: r.project_name ?? null,
    // no email, no AI summary — minimized.
  }));

  return NextResponse.json({ sessions });
}
