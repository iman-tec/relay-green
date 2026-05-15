/*
 * Fallback cron — abandons sessions stuck in `queued` for >90 seconds.
 *
 * Primary scheduling lives in Postgres (pg_cron) but Supabase Free tier
 * doesn't ship pg_cron. This Next.js route is the safety net: hit it from
 * Vercel Cron / GitHub Actions / external pinger every 60s.
 *
 * Auth: requires `CRON_SECRET` in the Authorization header (Bearer scheme).
 * Calls the `abandon_stale_queued_sessions()` SQL function via service role.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Auth gate
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
  const { data, error } = await supabase.rpc("abandon_stale_queued_sessions");

  if (error) {
    console.error("[cron/abandon-queued] error", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const abandoned = typeof data === "number" ? data : 0;
  return NextResponse.json({ ok: true, abandoned });
}
