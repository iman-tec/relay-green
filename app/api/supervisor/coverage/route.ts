/*
 * Supervisor coverage planner.
 *
 * GET /api/supervisor/coverage?days=7
 *   For each of the next N days (1–31), how many pod engineers are available
 *   per hour (from their weekly availability_windows, minus engineers on a
 *   holiday that date), plus the zero-coverage gap bands inside operating
 *   hours and a booking count.
 *
 *   {
 *     days, openHour, closeHour, engineerCount,
 *     calendar: [{ date, weekday, coverageByHour:number[24], bookings:number,
 *                  gaps:[{startHour,endHour}] }]
 *   }
 *
 * v1 computes in UTC hours — per-engineer window timezones are not yet
 * normalized (most data is UTC). Supervisor-gated, pod-scoped.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPEN_HOUR = 8; // operating window start (gaps only reported within)
const CLOSE_HOUR = 22; // operating window end (exclusive)

export async function GET(req: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data: roleRows } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (roles.includes(ROLE.super_admin) || !roles.includes(ROLE.supervisor)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: "service_role_not_configured" },
      { status: 500 }
    );
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const days = Math.min(
    31,
    Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 7))
  );

  const { data: myPod } = await admin
    .from("pod_members")
    .select("pod_id")
    .eq("user_id", user.id)
    .eq("pod_role", "supervisor")
    .maybeSingle();
  const podId = (myPod as { pod_id?: string } | null)?.pod_id ?? null;
  let engineerIds: string[] = [];
  if (podId) {
    const { data: members } = await admin
      .from("pod_members")
      .select("user_id")
      .eq("pod_id", podId)
      .eq("pod_role", "engineer");
    engineerIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  }
  if (engineerIds.length === 0) {
    return NextResponse.json({
      days,
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      engineerCount: 0,
      calendar: [],
    });
  }

  // Window of interest: [today 00:00 UTC, +days).
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 86_400_000);

  const [{ data: windows }, { data: holidays }, { data: bookings }] =
    await Promise.all([
      admin
        .from("engineer_availability_windows")
        .select("engineer_user_id, weekday, start_minute, end_minute")
        .in("engineer_user_id", engineerIds),
      admin
        .from("engineer_holidays")
        .select("engineer_user_id, holiday_date")
        .in("engineer_user_id", engineerIds)
        .gte("holiday_date", start.toISOString().slice(0, 10))
        .lt("holiday_date", end.toISOString().slice(0, 10)),
      admin
        .from("engineer_bookings")
        .select("engineer_user_id, slot_start")
        .in("engineer_user_id", engineerIds)
        .eq("status", "booked")
        .gte("slot_start", start.toISOString())
        .lt("slot_start", end.toISOString()),
    ]);

  type Win = {
    engineer_user_id: string;
    weekday: number;
    start_minute: number;
    end_minute: number;
  };
  const winsByWeekday = new Map<number, Win[]>();
  for (const w of (windows ?? []) as Win[]) {
    if (!winsByWeekday.has(w.weekday)) winsByWeekday.set(w.weekday, []);
    winsByWeekday.get(w.weekday)!.push(w);
  }
  const holidaySet = new Set<string>(); // `${engineer}|${date}`
  for (const h of (holidays ?? []) as {
    engineer_user_id: string;
    holiday_date: string;
  }[]) {
    holidaySet.add(`${h.engineer_user_id}|${h.holiday_date}`);
  }
  const bookingsByDate = new Map<string, number>();
  for (const b of (bookings ?? []) as { slot_start: string }[]) {
    const d = b.slot_start.slice(0, 10);
    bookingsByDate.set(d, (bookingsByDate.get(d) ?? 0) + 1);
  }

  const calendar = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const dateStr = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    const wins = (winsByWeekday.get(weekday) ?? []).filter(
      (w) => !holidaySet.has(`${w.engineer_user_id}|${dateStr}`)
    );

    const coverageByHour = new Array(24).fill(0);
    for (let h = 0; h < 24; h++) {
      const hourStart = h * 60,
        hourEnd = h * 60 + 60;
      const covering = new Set<string>();
      for (const w of wins) {
        if (w.start_minute < hourEnd && w.end_minute > hourStart)
          covering.add(w.engineer_user_id);
      }
      coverageByHour[h] = covering.size;
    }

    // Zero-coverage bands inside operating hours.
    const gaps: { startHour: number; endHour: number }[] = [];
    let gapStart: number | null = null;
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      if (coverageByHour[h] === 0) {
        if (gapStart === null) gapStart = h;
      } else if (gapStart !== null) {
        gaps.push({ startHour: gapStart, endHour: h });
        gapStart = null;
      }
    }
    if (gapStart !== null)
      gaps.push({ startHour: gapStart, endHour: CLOSE_HOUR });

    calendar.push({
      date: dateStr,
      weekday,
      coverageByHour,
      bookings: bookingsByDate.get(dateStr) ?? 0,
      gaps,
    });
  }

  return NextResponse.json({
    days,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    engineerCount: engineerIds.length,
    calendar,
  });
}
