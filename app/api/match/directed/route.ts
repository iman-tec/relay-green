/*
 * POST /api/match/directed  { intakeId: string, engineerId: string }
 *
 * Rings ONE specific engineer for the caller's own queued intake — the
 * "Connect" button in the customer's "Pick your engineer" modal, where the
 * customer reconnects with an engineer they've worked with before (by alias).
 *
 * Previously that button discarded the picked engineer and fell through to the
 * generic match_engineer RPC, which rings whatever best-fit engineer it
 * chooses — so "Connect with Luca" never actually rang Luca. This endpoint
 * places a DIRECTED pending offer at the chosen engineer, exactly like the
 * supervisor's supervisor_assign_engineer RPC
 * (supabase/migrations/20260524150000_supervisor_assign_directed_ring.sql):
 * a 60s pending offer, the engineer gets the normal EngineerIncomingMatch
 * popup, accept_match claims the session + starts billing on accept, and if
 * they don't pick up the existing advance_match cycle rings the next engineer
 * so the customer is never stranded.
 *
 * It runs with the service-role key (the same reason broadcast-match does:
 * works regardless of which match RPC version is live and dodges RLS on the
 * offers table). Authorisation is tight: the caller MUST be the intake's own
 * customer, and the target MUST be an engineer the caller has actually worked
 * with before (a prior claimed session). A busy/ineligible target returns
 * offered:0 so the client can fall back to the normal matcher.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Sessions a claimed engineer is considered "busy" on — never re-ring them.
const ACTIVE_CALL_STATUSES = [
  "assigned",
  "joining",
  "live",
  "grace",
  "expired_free",
  "ending",
];
const OFFER_WINDOW_MS = 60_000; // matches supervisor_assign_engineer's 60s

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    intakeId?: string;
    engineerId?: string;
  };
  const intakeId = body.intakeId;
  const engineerId = body.engineerId;
  if (!intakeId || !engineerId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "service_role_not_configured" },
      { status: 500 }
    );
  }
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Intake + its still-queued session. The caller must OWN this intake.
  const { data: intakeRow } = await admin
    .from("client_intakes")
    .select("id, guest_call_id, customer_user_id")
    .eq("id", intakeId)
    .maybeSingle();
  const intake = intakeRow as {
    id: string;
    guest_call_id: string | null;
    customer_user_id: string | null;
  } | null;
  if (!intake)
    return NextResponse.json({ error: "intake_not_found" }, { status: 404 });
  if (intake.customer_user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!intake.guest_call_id)
    return NextResponse.json({ offered: 0, skipped: "no_session" });

  // 2. Target must be an engineer the caller has genuinely worked with — the
  //    same relationship the picker is built from (a prior claimed session).
  const [roleRes, relRes] = await Promise.all([
    admin
      .from("user_role_names")
      .select("user_id")
      .eq("user_id", engineerId)
      .eq("role", "engineer")
      .maybeSingle(),
    admin
      .from("guest_calls")
      .select("id")
      .eq("customer_user_id", user.id)
      .eq("claimed_by", engineerId)
      .limit(1),
  ]);
  if (!roleRes.data) {
    return NextResponse.json({ error: "not_an_engineer" }, { status: 400 });
  }
  if (!relRes.data || relRes.data.length === 0) {
    return NextResponse.json(
      { error: "no_prior_relationship" },
      { status: 403 }
    );
  }

  // 3. Session must still be ringable (queued + unclaimed).
  const { data: callRow } = await admin
    .from("guest_calls")
    .select("id, status, claimed_by")
    .eq("id", intake.guest_call_id)
    .maybeSingle();
  const call = callRow as {
    id: string;
    status: string;
    claimed_by: string | null;
  } | null;
  if (!call || call.status !== "queued" || call.claimed_by) {
    return NextResponse.json({ offered: 0, skipped: "not_queued" });
  }

  // 4. Don't ring an engineer who's already on another live call — let the
  //    client fall back to the normal matcher rather than wait on someone who
  //    can't answer.
  const { data: busyRow } = await admin
    .from("guest_calls")
    .select("id")
    .eq("claimed_by", engineerId)
    .in("status", ACTIVE_CALL_STATUSES)
    .limit(1);
  if (busyRow && busyRow.length > 0) {
    return NextResponse.json({ offered: 0, reason: "busy" });
  }

  // 5. Directed ring: reuse this engineer's prior offer row for the intake if
  //    one exists (e.g. they declined earlier and the customer is re-ringing),
  //    otherwise insert a fresh pending offer. accept_match claims the session
  //    and stamps assigned_at on accept — that's when billing starts.
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + OFFER_WINDOW_MS).toISOString();

  const { data: existing } = await admin
    .from("engineer_match_offers")
    .select("id")
    .eq("intake_id", intake.id)
    .eq("engineer_user_id", engineerId)
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error: updErr } = await admin
      .from("engineer_match_offers")
      .update({
        status: "pending",
        guest_call_id: intake.guest_call_id,
        customer_user_id: intake.customer_user_id,
        offered_at: nowIso,
        expires_at: expiresIso,
        responded_at: null,
      })
      .eq("id", existing.id);
    if (updErr)
      return NextResponse.json({ error: updErr.message }, { status: 500 });
  } else {
    const { error: insErr } = await admin.from("engineer_match_offers").insert({
      intake_id: intake.id,
      guest_call_id: intake.guest_call_id,
      engineer_user_id: engineerId,
      customer_user_id: intake.customer_user_id,
      status: "pending",
      match_score: 0,
      offered_at: nowIso,
      expires_at: expiresIso,
    });
    if (insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 6. Session is actively ringing again → it no longer needs manual assign.
  await admin
    .from("guest_calls")
    .update({ reassign_needed: false, updated_at: nowIso })
    .eq("id", intake.guest_call_id)
    .eq("status", "queued");

  return NextResponse.json({ offered: 1, engineerId });
}
