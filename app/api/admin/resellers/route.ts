/*
 * Resellers API — list + create.
 *
 * GET  /api/admin/resellers
 *   Returns all resellers with computed enterprise counts. Caller must
 *   hold super_admin.
 *
 * POST /api/admin/resellers
 *   Creates a reseller row, an auth user for the contact email, links
 *   the profile to the reseller, grants the reseller role, optionally
 *   transfers the initial minutes allocation, and sends an invitation
 *   email via the Supabase invite-by-email path.
 *
 *   Body: { name, email, commission?, allocatedMinutes? }
 *   Returns: { reseller, contact, invited, attachedExisting }
 */

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResellerRow = {
  id: string;
  name: string;
  email: string | null;
  reseller_code: string;
  commission: number;
  allocated_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  status: string;
  owner_user_id: string | null;
  created_at: string;
};

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin } = gate;

  const { data: resellers, error } = await admin
    .from("resellers")
    .select(
      "id, name, email, reseller_code, commission, allocated_minutes, used_minutes, remaining_minutes, status, owner_user_id, created_at"
    )
    .order("created_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  if (!resellers || !resellers.length) {
    return NextResponse.json({ resellers: [] });
  }

  // Per-reseller enterprise list (full org rows for the right-pane detail
  // view) + rolled-up counts. One query, then group by reseller_id.
  const ids = resellers.map((r: ResellerRow) => r.id);
  const { data: orgRows } = await admin
    .from("organizations")
    .select(
      "id, name, primary_domain, status, enterprise_code, reseller_id, allocated_minutes, used_minutes, remaining_minutes, created_at"
    )
    .in("reseller_id", ids)
    .order("created_at", { ascending: false });

  type OrgRow = {
    id: string;
    name: string;
    primary_domain: string | null;
    status: string;
    enterprise_code: string;
    reseller_id: string;
    allocated_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
    created_at: string;
  };
  const orgs = (orgRows ?? []) as OrgRow[];

  const counts = new Map<string, { total: number; active: number }>();
  const enterprisesByReseller = new Map<
    string,
    ReturnType<typeof formatEnterprise>[]
  >();
  for (const o of orgs) {
    const c = counts.get(o.reseller_id) ?? { total: 0, active: 0 };
    c.total += 1;
    if (o.status === "active") c.active += 1;
    counts.set(o.reseller_id, c);

    const list = enterprisesByReseller.get(o.reseller_id) ?? [];
    list.push(formatEnterprise(o));
    enterprisesByReseller.set(o.reseller_id, list);
  }

  return NextResponse.json({
    resellers: (resellers as ResellerRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      resellerCode: r.reseller_code,
      commission: Number(r.commission ?? 0),
      allocatedMinutes: Number(r.allocated_minutes ?? 0),
      usedMinutes: Number(r.used_minutes ?? 0),
      remainingMinutes: Number(r.remaining_minutes ?? 0),
      status: r.status,
      ownerUserId: r.owner_user_id,
      totalEnterprises: counts.get(r.id)?.total ?? 0,
      activeEnterprises: counts.get(r.id)?.active ?? 0,
      enterprises: enterprisesByReseller.get(r.id) ?? [],
      createdAt: r.created_at,
    })),
  });
}

type EnterpriseDbRow = {
  id: string;
  name: string;
  primary_domain: string | null;
  status: string;
  enterprise_code: string;
  allocated_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  created_at: string;
};

function formatEnterprise(o: EnterpriseDbRow) {
  return {
    id: o.id,
    name: o.name,
    primaryDomain: o.primary_domain,
    status: o.status,
    enterpriseCode: o.enterprise_code,
    allocatedMinutes: Number(o.allocated_minutes ?? 0),
    usedMinutes: Number(o.used_minutes ?? 0),
    remainingMinutes: Number(o.remaining_minutes ?? 0),
    createdAt: o.created_at,
  };
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor } = gate;

  const { name, email, commission, allocatedMinutes } = (await request
    .json()
    .catch(() => ({}))) as {
    name?: string;
    email?: string;
    commission?: number | string;
    allocatedMinutes?: number | string;
  };

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json(
      { error: "Need name and email." },
      { status: 400 }
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  // Commission defaults to 20% when the creator leaves it blank.
  const commissionNum =
    commission === undefined || commission === "" ? 20 : Number(commission);
  if (Number.isNaN(commissionNum) || commissionNum < 0 || commissionNum > 100) {
    return NextResponse.json(
      { error: "Commission must be between 0 and 100." },
      { status: 400 }
    );
  }

  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json(
      { error: "Allocation must be non-negative." },
      { status: 400 }
    );
  }

  // Duplicate-email guard — reseller_email is unique in our schema, but
  // surface a clean message instead of letting the unique-violation bubble.
  const { data: existing } = await admin
    .from("resellers")
    .select("id")
    .ilike("email", cleanEmail)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "A reseller with this email already exists." },
      { status: 409 }
    );
  }

  // Insert the reseller row. The set-code trigger fills reseller_code in
  // the RLC-AB12CD format. Initial minutes columns stay at 0 until refill.
  const { data: resellerData, error: insertErr } = await admin
    .from("resellers")
    .insert({
      name: name.trim(),
      email: cleanEmail,
      commission: commissionNum,
      status: "active",
      created_by_user_id: actor.id,
    })
    .select("id, name, email, reseller_code, commission, status, created_at")
    .single();
  if (insertErr || !resellerData) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Couldn't create reseller." },
      { status: 400 }
    );
  }
  const reseller = resellerData as ResellerRow;

  // Send the Supabase invite (creates the auth user if new; magic-link
  // fallback for existing-confirmed users). Metadata carries the
  // spec-required fields so the email template can render them.
  const invite = await sendInvitationEmail(admin, {
    email: cleanEmail,
    displayName: name.trim(),
    metadata: {
      role_label: "reseller",
      reseller_id: reseller.id,
      reseller_code: reseller.reseller_code,
      allocated_minutes: allocNum,
      created_by: actor.id,
    },
  });
  if (!invite.ok) {
    await admin.from("resellers").delete().eq("id", reseller.id);
    return NextResponse.json({ error: invite.error }, { status: 400 });
  }

  let userId = invite.userId ?? null;
  if (!userId) {
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId =
      lookup.data?.users?.find((u) => u.email?.toLowerCase() === cleanEmail)
        ?.id ?? null;
  }
  if (!userId) {
    await admin.from("resellers").delete().eq("id", reseller.id);
    return NextResponse.json(
      {
        error:
          "Reseller invited but auth row not yet visible — try again in a moment.",
      },
      { status: 500 }
    );
  }

  // Look up reseller role_id and link the user as the reseller owner.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.reseller)
    .maybeSingle();
  const resellerRoleId = (roleRow as { id: string } | null)?.id;
  if (!resellerRoleId) {
    await admin.from("resellers").delete().eq("id", reseller.id);
    return NextResponse.json(
      { error: "reseller role not seeded" },
      { status: 500 }
    );
  }

  // Update the profile with reseller_id + full_name (only if blank).
  const { data: currentProfile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const fullNameInsert = (
    currentProfile as { full_name: string | null } | null
  )?.full_name?.trim()
    ? undefined
    : name.trim();

  const profileUpdate: Record<string, unknown> = {
    id: userId,
    reseller_id: reseller.id,
    is_onboarded: true,
  };
  if (fullNameInsert) profileUpdate.full_name = fullNameInsert;

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(profileUpdate, { onConflict: "id" });
  if (profileErr) {
    await admin.from("resellers").delete().eq("id", reseller.id);
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  // Grant the reseller role (idempotent).
  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: resellerRoleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true }
    );

  // Link the reseller's owner_user_id back to the user.
  await admin
    .from("resellers")
    .update({ owner_user_id: userId })
    .eq("id", reseller.id);

  // Initial minutes allocation via the RPC (atomic, validates ≥ 0).
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_reseller", {
      _reseller_id: reseller.id,
      _amount: allocNum,
    });
    if (tErr) {
      // Reseller is created and invited; we just couldn't credit the
      // initial pool. Surface this as a soft warning rather than rolling
      // back — the super admin can hit "Add minutes" to retry.
      console.warn("[admin/resellers] initial transfer failed:", tErr.message);
    }
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  return NextResponse.json({
    reseller: {
      id: reseller.id,
      name: reseller.name,
      email: reseller.email,
      resellerCode: reseller.reseller_code,
      commission: Number(reseller.commission ?? 0),
      status: reseller.status,
      createdAt: reseller.created_at,
    },
    contact: {
      id: userId,
      email: cleanEmail,
      displayName: name.trim(),
    },
    invited: mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
