/*
 * POST /api/enterprise/regenerate-code
 *
 * Rotates the org's enterprise_code. Old code stops working immediately
 * (it only matters for /enterprise admin reference — invites use the code
 * baked into the link, which is signed by Supabase Auth and unaffected
 * by rotation).
 */

import { NextResponse } from "next/server";
import { requireEnterpriseAdmin } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const CROCKFORD = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function randSegment(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  }
  return out;
}

export async function POST() {
  const gate = await requireEnterpriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, orgId } = gate;

  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();
  const slug = (org?.name ?? "ORG").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "ORG";

  // Retry on unique-violation. 5 tries is enough for 30^8 keyspace.
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = `${slug}-${randSegment(4)}-${randSegment(4)}`;
    const { data, error } = await admin
      .from("organizations")
      .update({ enterprise_code: next })
      .eq("id", orgId)
      .select("enterprise_code")
      .single();
    if (!error && data) {
      return NextResponse.json({ enterpriseCode: data.enterprise_code });
    }
    if (error?.code !== "23505") {
      return NextResponse.json({ error: error?.message ?? "Couldn't rotate code." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Couldn't generate a unique code after 5 tries." }, { status: 500 });
}
