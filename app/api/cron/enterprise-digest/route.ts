/*
 * Weekly enterprise usage digest — fan-out in-app notifications.
 *
 * Calls enterprise_weekly_digest(), which inserts a "Weekly usage digest"
 * notification for every org's enterprise admins (gated by the org's
 * weekly_digest pref) summarizing the last 7 days. Returns the org count.
 *
 * Schedule this WEEKLY (Vercel Cron / GitHub Actions / external pinger).
 * Auth: requires CRON_SECRET in the Authorization header (Bearer scheme).
 *
 * NOTE: delivery is IN-APP only (it lands in the enterprise notification
 * bell). Email delivery is out of scope until Resend is configured.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("enterprise_weekly_digest");
  if (error) {
    console.error("[cron/enterprise-digest] error", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const orgsNotified = typeof data === "number" ? data : 0;
  return NextResponse.json({ ok: true, orgsNotified });
}
