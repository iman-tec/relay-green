/*
 * GET /api/channel-partners — public list of active channel partners.
 *
 * Powers the "Channel Partner" picker on the enterprise inquiry form.
 * Returns only id + name (no minutes, commission, owner, or codes) so the
 * public marketing form can populate a dropdown without leaking sensitive
 * reseller data. Uses the service role because the resellers table's RLS
 * only exposes rows to super_admins / the owning reseller.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ channelPartners: [] });
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin
    .from("resellers")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    console.error("[channel-partners] list failed:", error.message);
    return NextResponse.json({ channelPartners: [] });
  }

  return NextResponse.json({
    channelPartners: (data ?? []).map((r: { id: string; name: string }) => ({
      id: r.id,
      name: r.name,
    })),
  });
}
