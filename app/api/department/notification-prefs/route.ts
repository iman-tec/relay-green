/*
 * Department-admin notification preferences.
 *
 * GET /api/department/notification-prefs   → current toggles (all-on
 *                                            defaults when no row exists).
 * PUT /api/department/notification-prefs   → upsert toggles. Body is any
 *                                            subset of the three booleans;
 *                                            unspecified ones keep their
 *                                            current value.
 *
 * Scoped to the caller's department via requireDepartmentAdmin().
 */

import { NextResponse } from "next/server";
import { requireDepartmentAdmin } from "@/lib/department-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PrefsRow = {
  new_session_alerts:  boolean;
  low_minutes_warning: boolean;
  new_member_joined:   boolean;
};

const DEFAULTS = {
  sessions:   true,
  lowMinutes: true,
  newMember:  true,
};

export async function GET() {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const { data, error } = await admin
    .from("department_notification_prefs")
    .select("new_session_alerts, low_minutes_warning, new_member_joined")
    .eq("department_id", departmentId)
    .maybeSingle<PrefsRow>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prefs: data
      ? {
          sessions:   data.new_session_alerts,
          lowMinutes: data.low_minutes_warning,
          newMember:  data.new_member_joined,
        }
      : DEFAULTS,
  });
}

export async function PUT(request: Request) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    sessions?:   boolean;
    lowMinutes?: boolean;
    newMember?:  boolean;
  };

  const { data: existing } = await admin
    .from("department_notification_prefs")
    .select("new_session_alerts, low_minutes_warning, new_member_joined")
    .eq("department_id", departmentId)
    .maybeSingle<PrefsRow>();

  const merged = {
    department_id:       departmentId,
    new_session_alerts:  body.sessions   ?? existing?.new_session_alerts  ?? DEFAULTS.sessions,
    low_minutes_warning: body.lowMinutes ?? existing?.low_minutes_warning ?? DEFAULTS.lowMinutes,
    new_member_joined:   body.newMember  ?? existing?.new_member_joined   ?? DEFAULTS.newMember,
  };

  const { error } = await admin
    .from("department_notification_prefs")
    .upsert(merged, { onConflict: "department_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    prefs: {
      sessions:   merged.new_session_alerts,
      lowMinutes: merged.low_minutes_warning,
      newMember:  merged.new_member_joined,
    },
  });
}
