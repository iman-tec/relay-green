/*
 * Enterprise admin notification preferences.
 *
 * GET /api/enterprise/notification-prefs   → current toggles (all-on
 *                                            defaults when no row exists).
 * PUT /api/enterprise/notification-prefs   → upsert toggles. Body is any
 *                                            subset of the three booleans;
 *                                            unspecified ones keep their
 *                                            current value (so partial
 *                                            PUTs don't blow away unsent
 *                                            toggles).
 *
 * Mirror of /api/reseller/notification-prefs, scoped to the caller's
 * organization via requireEnterpriseAdmin().
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PrefsRow = {
  organization_id: string;
  session_alerts:  boolean;
  low_minutes:     boolean;
  weekly_digest:   boolean;
};

const DEFAULTS = {
  sessionAlerts: true,
  lowMinutes:    true,
  weeklyDigest:  true,
};

export async function GET() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data, error } = await admin
    .from("enterprise_notification_prefs")
    .select("session_alerts, low_minutes, weekly_digest")
    .eq("organization_id", orgId)
    .maybeSingle<Omit<PrefsRow, "organization_id">>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prefs: data
      ? {
          sessionAlerts: data.session_alerts,
          lowMinutes:    data.low_minutes,
          weeklyDigest:  data.weekly_digest,
        }
      : DEFAULTS,
  });
}

export async function PUT(request: Request) {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    sessionAlerts?: boolean;
    lowMinutes?:    boolean;
    weeklyDigest?:  boolean;
  };

  const { data: existing } = await admin
    .from("enterprise_notification_prefs")
    .select("session_alerts, low_minutes, weekly_digest")
    .eq("organization_id", orgId)
    .maybeSingle<Omit<PrefsRow, "organization_id">>();

  const merged = {
    organization_id: orgId,
    session_alerts:  body.sessionAlerts ?? existing?.session_alerts ?? DEFAULTS.sessionAlerts,
    low_minutes:     body.lowMinutes    ?? existing?.low_minutes    ?? DEFAULTS.lowMinutes,
    weekly_digest:   body.weeklyDigest  ?? existing?.weekly_digest  ?? DEFAULTS.weeklyDigest,
  };

  const { error } = await admin
    .from("enterprise_notification_prefs")
    .upsert(merged, { onConflict: "organization_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prefs: {
      sessionAlerts: merged.session_alerts,
      lowMinutes:    merged.low_minutes,
      weeklyDigest:  merged.weekly_digest,
    },
  });
}
