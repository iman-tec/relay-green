/*
 * POST /api/staff/broadcast-match  { intakeId: string }
 *
 * Rings EVERY currently-online engineer for a queued intake at once
 * (first-accept-wins). This is the broadcast step the product wants the
 * moment the first engineer declines, plus the supervisor's manual
 * "Broadcast to all" button.
 *
 * WHY THIS LIVES IN AN API ROUTE (and not only in the match_engineer RPC):
 * the deployed match_engineer gates eligibility on engineer_profiles
 * .is_available = true, which the client presence watcher routinely leaves
 * stuck `false` for engineers who are plainly online (tab open, heartbeating).
 * That silently shrinks the broadcast pool to nobody, so a decline falls
 * straight to the supervisor as "Engineer declined" and no-one else ever
 * rings. This endpoint uses the ROBUST signal — a fresh heartbeat OR an
 * explicit is_available — exactly like the corrected match_engineer in
 * supabase/migrations/20260529150000_match_engineer_tiered_escalation.sql,
 * and runs with the service-role key so it works regardless of which version
 * of the DB function is live.
 *
 * Eligible engineer = role 'engineer', not the customer, heartbeat-fresh
 * (<90s) OR is_available, not already on an active call, not in the intake's
 * declined_by, and without an existing offer row for this intake. We insert
 * one pending offer per eligible engineer (the table fills status/expires_at
 * defaults) and clear guest_calls.reassign_needed so the session leaves the
 * supervisor's "needs manual assign" state.
 *
 * Auth: any staff role (engineer triggers it on their own decline;
 * supervisor triggers it from the matching board). Real first-accept-wins
 * atomicity is still enforced by accept_match server-side.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { STAFF_ROLES } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const HEARTBEAT_FRESH_MS = 90_000; // matches match_engineer's 90s window
// Sessions a claimed engineer is considered "busy" on — never re-ring them.
const ACTIVE_CALL_STATUSES = ["assigned", "joining", "live", "grace", "expired_free", "ending"];

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { intakeId?: string };
  const intakeId = body.intakeId;
  if (!intakeId) return NextResponse.json({ error: "missing_intake_id" }, { status: 400 });

  // Caller must be staff (engineer declining, or supervisor on the board).
  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const callerRoles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (!callerRoles.some((r) => (STAFF_ROLES as readonly string[]).includes(r))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "service_role_not_configured" }, { status: 500 });
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Intake + its still-queued session.
  const { data: intakeRow } = await admin
    .from("client_intakes")
    .select("id, guest_call_id, customer_user_id, declined_by")
    .eq("id", intakeId)
    .maybeSingle();
  const intake = intakeRow as {
    id: string;
    guest_call_id: string | null;
    customer_user_id: string | null;
    declined_by: string[] | null;
  } | null;
  if (!intake) return NextResponse.json({ error: "intake_not_found" }, { status: 404 });
  if (!intake.guest_call_id) return NextResponse.json({ offered: 0, skipped: "no_session" });

  const { data: callRow } = await admin
    .from("guest_calls")
    .select("id, status, claimed_by")
    .eq("id", intake.guest_call_id)
    .maybeSingle();
  const call = callRow as { id: string; status: string; claimed_by: string | null } | null;
  // Only broadcast a session that's still waiting and unclaimed.
  if (!call || call.status !== "queued" || call.claimed_by) {
    return NextResponse.json({ offered: 0, skipped: "not_queued" });
  }

  // 2. Gather the candidate pool + the signals we filter on, in parallel.
  const [engRoleRes, presRes, profRes, busyRes, offersRes] = await Promise.all([
    admin.from("user_role_names").select("user_id").eq("role", "engineer"),
    admin.from("engineer_presence").select("engineer_id, last_seen_at"),
    admin.from("engineer_profiles").select("user_id, is_available"),
    admin.from("guest_calls").select("claimed_by, status").in("status", ACTIVE_CALL_STATUSES),
    admin.from("engineer_match_offers").select("engineer_user_id").eq("intake_id", intake.id),
  ]);

  const engineerIds = new Set(
    ((engRoleRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );

  const now = Date.now();
  const freshById = new Map<string, boolean>();
  for (const p of (presRes.data ?? []) as { engineer_id: string; last_seen_at: string | null }[]) {
    const fresh = !!p.last_seen_at && now - new Date(p.last_seen_at).getTime() < HEARTBEAT_FRESH_MS;
    freshById.set(p.engineer_id, fresh);
  }
  const availableById = new Map<string, boolean>();
  for (const p of (profRes.data ?? []) as { user_id: string; is_available: boolean | null }[]) {
    availableById.set(p.user_id, !!p.is_available);
  }
  const busyIds = new Set(
    ((busyRes.data ?? []) as { claimed_by: string | null }[])
      .map((r) => r.claimed_by)
      .filter((id): id is string => !!id),
  );
  const alreadyOffered = new Set(
    ((offersRes.data ?? []) as { engineer_user_id: string }[]).map((r) => r.engineer_user_id),
  );
  const declined = new Set(intake.declined_by ?? []);

  // 3. Eligibility — the robust "are they here" rule: heartbeat-fresh OR
  //    explicitly available. is_available alone is NOT trusted (it gets stuck
  //    false on online engineers — the bug this endpoint exists to dodge).
  const eligible = [...engineerIds].filter((id) =>
    id !== intake.customer_user_id &&
    (freshById.get(id) || availableById.get(id)) &&
    !busyIds.has(id) &&
    !declined.has(id) &&
    !alreadyOffered.has(id),
  );

  if (eligible.length === 0) {
    // No NEW engineer to ring. But an earlier broadcast may still have live
    // offers out (e.g. engineer #2 declines while #3 and #4 are still
    // ringing) — don't strand a session that's actively ringing. Only fall
    // to the supervisor when nobody is ringing anymore.
    const { count } = await admin
      .from("engineer_match_offers")
      .select("id", { count: "exact", head: true })
      .eq("intake_id", intake.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());
    if ((count ?? 0) > 0) {
      return NextResponse.json({ offered: 0, stillRinging: true });
    }
    // Genuinely nobody online and nobody ringing → leave it for the supervisor.
    await admin
      .from("guest_calls")
      .update({ reassign_needed: true, updated_at: new Date().toISOString() })
      .eq("id", intake.guest_call_id)
      .eq("status", "queued");
    return NextResponse.json({ offered: 0, reassignNeeded: true });
  }

  // 4. Fan out one pending offer per eligible engineer. Table defaults fill
  //    status='pending', offered_at=now(), expires_at=now()+30s.
  const rows = eligible.map((engineerId) => ({
    intake_id:        intake.id,
    guest_call_id:    intake.guest_call_id,
    engineer_user_id: engineerId,
    customer_user_id: intake.customer_user_id,
    match_score:      0,
  }));
  const { error: insErr } = await admin.from("engineer_match_offers").insert(rows);
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 5. Session is actively ringing again → it no longer needs manual assign.
  await admin
    .from("guest_calls")
    .update({ reassign_needed: false, updated_at: new Date().toISOString() })
    .eq("id", intake.guest_call_id)
    .eq("status", "queued");

  return NextResponse.json({ offered: eligible.length });
}
