/*
 * POST /api/reseller/enterprises/:id/nudge
 *   Send a friendly in-app reminder to a company's admin (e.g. low activity, or
 *   to finish setup). Creates a notification via the create_notification RPC.
 *   Scoped: the org must belong to the caller's reseller. Aggregate-safe — the
 *   partner never sees the client's members, only nudges their admin.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const gate = await requireReseller();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const { id: orgId } = await params;
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, reseller_id")
    .eq("id", orgId)
    .maybeSingle();
  const o = org as {
    id: string;
    name: string;
    reseller_id: string | null;
  } | null;
  if (!o || o.reseller_id !== resellerId) {
    return NextResponse.json({ error: "not_your_client" }, { status: 404 });
  }

  // Reseller display name for the nudge copy.
  const { data: r } = await admin
    .from("resellers")
    .select("name")
    .eq("id", resellerId)
    .maybeSingle();
  const partnerName = (r as { name: string } | null)?.name ?? "Your partner";

  // The org's enterprise_admin(s).
  const { data: admins } = await admin
    .from("profiles_with_role")
    .select("id, primary_role")
    .eq("organization_id", orgId)
    .eq("primary_role", ROLE.enterprise_admin);
  const ids = ((admins ?? []) as { id: string }[]).map((a) => a.id);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "No admin to nudge for this company." },
      { status: 404 }
    );
  }

  await Promise.all(
    ids.map((userId) =>
      admin
        .rpc("create_notification", {
          _user_id: userId,
          _request_id: null,
          _kind: "partner_nudge",
          _title: `A reminder from ${partnerName}`,
          _body:
            "Your channel partner nudged you to check in on your Relay account.",
        })
        .then(({ error }) => {
          if (error)
            console.warn("[nudge] create_notification failed:", error.message);
        })
    )
  );

  return NextResponse.json({ ok: true });
}
