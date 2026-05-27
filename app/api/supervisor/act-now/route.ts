/*
 * Supervisor "act-now" feed — the left-rail queue.
 *
 * GET /api/supervisor/act-now
 *   {
 *     estimationRequests: pending project_quote_requests (golive/maintain),
 *                         the Job-3 front door — newest first
 *     callbackQueue:      pending engineer_connect_requests for engineers in
 *                         the caller's pod, with age + SLA-breach flag (>30m)
 *   }
 *
 * Supervisor-gated (super_admin excluded — they have the global admin views).
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const SLA_BREACH_MS = 30 * 60 * 1000; // callback waiting > 30 min

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Caller's pod + its engineers (for callback scoping).
  const { data: myPod } = await admin
    .from("pod_members").select("pod_id").eq("user_id", user.id).eq("pod_role", "supervisor").maybeSingle();
  const podId = (myPod as { pod_id?: string } | null)?.pod_id ?? null;
  let podEngineerIds: string[] = [];
  if (podId) {
    const { data: members } = await admin
      .from("pod_members").select("user_id").eq("pod_id", podId).eq("pod_role", "engineer");
    podEngineerIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  }

  // Pending estimation requests (golive/maintain) + pod callback queue +
  // open escalations raised by the pod's engineers.
  const [{ data: quotes }, { data: callbacks }, { data: escalations }] = await Promise.all([
    admin
      .from("project_quote_requests")
      .select("id, kind, comments, status, created_at, project_id, customer_user_id")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50),
    podEngineerIds.length
      ? admin
          .from("engineer_connect_requests")
          .select("id, customer_user_id, engineer_user_id, project_id, message, status, created_at, expires_at")
          .eq("status", "pending")
          .in("engineer_user_id", podEngineerIds)
          .order("created_at", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    (podId || podEngineerIds.length)
      ? admin
          .from("session_escalations")
          .select("id, session_id, engineer_user_id, reason, note, created_at, pod_id")
          .eq("status", "open")
          .or([
            podId ? `pod_id.eq.${podId}` : "",
            podEngineerIds.length ? `engineer_user_id.in.(${podEngineerIds.join(",")})` : "",
          ].filter(Boolean).join(","))
          .order("created_at", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  type Q = { id: string; kind: string; comments: string | null; created_at: string; project_id: string; customer_user_id: string };
  type C = { id: string; customer_user_id: string; engineer_user_id: string; project_id: string | null; message: string | null; created_at: string };
  type E = { id: string; session_id: string; engineer_user_id: string; reason: string; note: string | null; created_at: string };
  const qs = (quotes ?? []) as Q[];
  const cs = (callbacks ?? []) as C[];
  const es = (escalations ?? []) as E[];

  // Resolve names (profiles) + project names + escalation session customers.
  const userIds = new Set<string>();
  const projectIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const q of qs) { userIds.add(q.customer_user_id); projectIds.add(q.project_id); }
  for (const c of cs) { userIds.add(c.customer_user_id); userIds.add(c.engineer_user_id); if (c.project_id) projectIds.add(c.project_id); }
  for (const e of es) { userIds.add(e.engineer_user_id); sessionIds.add(e.session_id); }

  const [{ data: profs }, { data: projs }, { data: sess }] = await Promise.all([
    userIds.size ? admin.from("profiles").select("id, full_name").in("id", [...userIds]) : Promise.resolve({ data: [] }),
    projectIds.size ? admin.from("projects").select("id, name").in("id", [...projectIds]) : Promise.resolve({ data: [] }),
    sessionIds.size ? admin.from("guest_calls").select("id, guest_name").in("id", [...sessionIds]) : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) nameById.set(p.id, p.full_name);
  const projById = new Map<string, string>();
  for (const p of (projs ?? []) as { id: string; name: string | null }[]) if (p.name) projById.set(p.id, p.name);
  const custBySession = new Map<string, string>();
  for (const s of (sess ?? []) as { id: string; guest_name: string | null }[]) if (s.guest_name) custBySession.set(s.id, s.guest_name);

  const now = Date.now();
  return NextResponse.json({
    estimationRequests: qs.map((q) => ({
      id: q.id,
      kind: q.kind, // 'golive' | 'maintain'
      customer: nameById.get(q.customer_user_id) ?? "Customer",
      project: projById.get(q.project_id) ?? "Untitled project",
      projectId: q.project_id,
      comments: q.comments,
      createdAt: q.created_at,
    })),
    callbackQueue: cs.map((c) => {
      const ageMs = now - new Date(c.created_at).getTime();
      return {
        id: c.id,
        customer: nameById.get(c.customer_user_id) ?? "Customer",
        engineer: nameById.get(c.engineer_user_id) ?? "Engineer",
        project: c.project_id ? projById.get(c.project_id) ?? null : null,
        message: c.message,
        createdAt: c.created_at,
        slaBreached: ageMs > SLA_BREACH_MS,
      };
    }),
    escalations: es.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      engineer: nameById.get(e.engineer_user_id) ?? "Engineer",
      customer: custBySession.get(e.session_id) ?? "Customer",
      reason: e.reason,
      note: e.note,
      createdAt: e.created_at,
    })),
  });
}
