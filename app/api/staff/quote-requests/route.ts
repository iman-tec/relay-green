/*
 * Engineer-facing quote/contract queue. Lists open quote requests (pending =
 * needs a bid; quoted = bid sent, awaiting the customer) with project +
 * customer context + appointment flag.
 *
 * GET /api/staff/quote-requests
 *   { requests: [{ id, kind, status, customer, project, projectId, comments,
 *                  amountCents, createdAt, respondedAt, appointmentRequestedAt,
 *                  appointmentNote }] }
 *
 * Engineer and above.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const { data: roleRows } = await supabase.from("user_role_names").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!roles.some((r) => [ROLE.engineer, ROLE.supervisor, ROLE.super_admin].includes(r as never))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // 'committed' joins 'pending' + 'quoted' here so the engineer-side
  // inbox can render an "Accepted bid" filter chip with its own count —
  // the customer-paid state still belongs in the engineer's queue as a
  // record-of-work even though no further action is required.
  const { data: rows } = await admin
    .from("project_quote_requests")
    .select("id, kind, status, comments, created_at, responded_at, project_id, customer_user_id, quote_amount_cents, appointment_requested_at, appointment_note")
    .in("status", ["pending", "quoted", "committed"])
    .order("created_at", { ascending: false })
    .limit(100);
  const qs = (rows ?? []) as {
    id: string; kind: string; status: string; comments: string | null; created_at: string; responded_at: string | null;
    project_id: string; customer_user_id: string; quote_amount_cents: number | null;
    appointment_requested_at: string | null; appointment_note: string | null;
  }[];
  if (qs.length === 0) return NextResponse.json({ requests: [] });

  const custIds = [...new Set(qs.map((q) => q.customer_user_id))];
  const projIds = [...new Set(qs.map((q) => q.project_id))];
  const [{ data: profs }, { data: projs }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", custIds),
    admin.from("projects").select("id, name").in("id", projIds),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) nameById.set(p.id, p.full_name);
  const projById = new Map<string, string>();
  for (const p of (projs ?? []) as { id: string; name: string | null }[]) if (p.name) projById.set(p.id, p.name);

  return NextResponse.json({
    requests: qs.map((q) => ({
      id: q.id,
      kind: q.kind,
      status: q.status,
      customer: nameById.get(q.customer_user_id) ?? "Customer",
      project: projById.get(q.project_id) ?? "Untitled project",
      projectId: q.project_id,
      comments: q.comments,
      amountCents: q.quote_amount_cents,
      createdAt: q.created_at,
      respondedAt: q.responded_at,
      appointmentRequestedAt: q.appointment_requested_at,
      appointmentNote: q.appointment_note,
    })),
  });
}
