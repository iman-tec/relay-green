/*
 * Reseller notification preferences.
 *
 * GET /api/reseller/notification-prefs   → current toggles. Returns the
 *                                          default-on values when no row
 *                                          exists yet (lazy default).
 * PUT /api/reseller/notification-prefs   → upsert toggles. Body is any
 *                                          subset of the three booleans.
 *
 * Defaults: all three events on (new client onboarded, client low-minutes,
 * payout processed). Consumed by /api/reseller/enterprises and
 * /api/admin/orgs to gate notification inserts.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PrefsRow = {
  reseller_id:          string;
  new_client_onboarded: boolean;
  client_low_minutes:   boolean;
  payout_processed:     boolean;
};

const DEFAULTS = {
  newClientOnboarded: true,
  clientLowMinutes:   true,
  payoutProcessed:    true,
};

export async function GET() {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { data, error } = await admin
    .from("reseller_notification_prefs")
    .select("new_client_onboarded, client_low_minutes, payout_processed")
    .eq("reseller_id", resellerId)
    .maybeSingle<Omit<PrefsRow, "reseller_id">>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prefs: data
      ? {
          newClientOnboarded: data.new_client_onboarded,
          clientLowMinutes:   data.client_low_minutes,
          payoutProcessed:    data.payout_processed,
        }
      : DEFAULTS,
  });
}

export async function PUT(request: Request) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    newClientOnboarded?: boolean;
    clientLowMinutes?:   boolean;
    payoutProcessed?:    boolean;
  };

  // Resolve incoming values against existing row (or defaults) so that a
  // partial PUT doesn't blow away unsent toggles.
  const { data: existing } = await admin
    .from("reseller_notification_prefs")
    .select("new_client_onboarded, client_low_minutes, payout_processed")
    .eq("reseller_id", resellerId)
    .maybeSingle<Omit<PrefsRow, "reseller_id">>();

  const merged = {
    reseller_id:          resellerId,
    new_client_onboarded: body.newClientOnboarded ?? existing?.new_client_onboarded ?? DEFAULTS.newClientOnboarded,
    client_low_minutes:   body.clientLowMinutes   ?? existing?.client_low_minutes   ?? DEFAULTS.clientLowMinutes,
    payout_processed:     body.payoutProcessed    ?? existing?.payout_processed     ?? DEFAULTS.payoutProcessed,
  };

  const { error } = await admin
    .from("reseller_notification_prefs")
    .upsert(merged, { onConflict: "reseller_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prefs: {
      newClientOnboarded: merged.new_client_onboarded,
      clientLowMinutes:   merged.client_low_minutes,
      payoutProcessed:    merged.payout_processed,
    },
  });
}
