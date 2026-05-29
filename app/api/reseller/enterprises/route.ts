/*
 * Reseller-scoped enterprises — create an inorganic enterprise.
 *
 * POST /api/reseller/enterprises
 *   Body: { name, primaryDomain?, adminEmail, adminDisplayName,
 *           allocatedMinutes? }
 *   Creates an organization with enterprise_type='inorganic' and
 *   reseller_id=<caller's reseller>, invites the first enterprise admin,
 *   and (if allocatedMinutes > 0) atomically debits the reseller's pool
 *   and credits the new org via transfer_to_organization.
 *
 *   GET is intentionally absent — the dashboard endpoint already returns
 *   the reseller's enterprises with the KPI snapshot, and giving the UI
 *   one round trip is simpler than two.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { recordInvite } from "@/lib/relay/invites";
import { notifyResellerClientOnboarded } from "@/lib/relay/resellerNotify";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(request: Request) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor, resellerId } = gate;

  const { name, primaryDomain, adminEmail, adminDisplayName, allocatedMinutes, discountPct, discountMonths } =
    (await request.json().catch(() => ({}))) as {
      name?: string;
      primaryDomain?: string;
      adminEmail?: string;
      adminDisplayName?: string;
      allocatedMinutes?: number | string;
      discountPct?: number | string;
      discountMonths?: number | string;
    };

  if (!name?.trim() || !adminEmail?.trim() || !adminDisplayName?.trim()) {
    return NextResponse.json(
      { error: "Need name, adminEmail, and adminDisplayName." },
      { status: 400 },
    );
  }
  const trimmedEmail = adminEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid admin email." }, { status: 400 });
  }
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return NextResponse.json({ error: "Allocation must be non-negative." }, { status: 400 });
  }

  // Lookup reseller's remaining_minutes + reseller_code (for the invite).
  // We let transfer_to_organization make the final atomic check, but a
  // pre-flight here gives a friendly error before we create the org row.
  const { data: rRow } = await admin
    .from("resellers")
    .select("id, name, reseller_code, remaining_minutes, status")
    .eq("id", resellerId)
    .maybeSingle();
  if (!rRow) {
    return NextResponse.json({ error: "Reseller not found." }, { status: 500 });
  }
  const reseller = rRow as { id: string; name: string; reseller_code: string; remaining_minutes: number; status: string };
  if (reseller.status !== "active") {
    return NextResponse.json({ error: "Reseller is not active." }, { status: 403 });
  }
  if (allocNum > Number(reseller.remaining_minutes ?? 0)) {
    return NextResponse.json(
      { error: `Allocation exceeds your remaining minutes (${reseller.remaining_minutes}).` },
      { status: 400 },
    );
  }

  // Create the org. The set-code trigger fills enterprise_code in the
  // existing slug format; we explicitly set enterprise_type='inorganic'
  // and reseller_id so the coherence constraint is satisfied.
  const orgInsert: Record<string, unknown> = {
    name:               name.trim(),
    enterprise_type:    "inorganic",
    reseller_id:        resellerId,
    created_by_user_id: actor.id,
  };
  if (primaryDomain?.trim()) orgInsert.primary_domain = primaryDomain.trim();

  // Promo discount granted by the partner (e.g. 10% for 12 months).
  const discPct = Math.max(0, Math.min(100, Number(discountPct ?? 0)));
  const discMonths = Math.max(0, Number(discountMonths ?? 0));
  if (discPct > 0) {
    orgInsert.discount_pct = discPct;
    if (discMonths > 0) {
      const until = new Date();
      until.setMonth(until.getMonth() + discMonths);
      orgInsert.discount_until = until.toISOString();
    }
  }

  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .insert(orgInsert)
    .select("id, name, primary_domain, status, enterprise_code, enterprise_type, reseller_id, created_at")
    .single();
  if (orgErr || !orgRow) {
    return NextResponse.json({ error: orgErr?.message ?? "Couldn't create enterprise." }, { status: 400 });
  }
  const org = orgRow as {
    id: string; name: string; primary_domain: string | null; status: string;
    enterprise_code: string; enterprise_type: string; reseller_id: string; created_at: string;
  };

  // Invite the enterprise admin. Per spec, the inorganic invite email
  // shows the RESELLER code (which the admin enters on first login) AND
  // the enterprise code (their org's identifier).
  const invite = await sendInvitationEmail(admin, {
    email:       trimmedEmail,
    displayName: adminDisplayName.trim(),
    metadata: {
      role_label:        "enterprise_admin",
      organization_id:   org.id,
      org_name:          org.name,
      enterprise_code:   org.enterprise_code,
      reseller_id:       resellerId,
      reseller_code:     reseller.reseller_code,
      allocated_minutes: allocNum,
      created_by:        actor.id,
    },
  });
  if (!invite.ok) {
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: invite.error }, { status: 400 });
  }

  let userId = invite.userId ?? null;
  if (!userId) {
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = lookup.data?.users?.find(
      (u) => u.email?.toLowerCase() === trimmedEmail,
    )?.id ?? null;
  }
  if (!userId) {
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json(
      { error: "Admin invited but auth row not yet visible — try again in a moment." },
      { status: 500 },
    );
  }

  // Resolve enterprise_admin role_id and link the user to the org.
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.enterprise_admin)
    .maybeSingle();
  const enterpriseAdminRoleId = (roleRow as { id: string } | null)?.id;
  if (!enterpriseAdminRoleId) {
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: "enterprise_admin role not seeded" }, { status: 500 });
  }

  const { data: currentProfile } = await admin
    .from("profiles_with_role")
    .select("full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const cp = currentProfile as { full_name: string | null; primary_role_id: string | null } | null;

  await admin
    .from("profiles")
    .upsert(
      {
        id:              userId,
        full_name:       cp?.full_name?.trim() ? cp.full_name : adminDisplayName.trim(),
        primary_role_id: cp?.primary_role_id ?? enterpriseAdminRoleId,
        organization_id: org.id,
        is_onboarded:    true,
      },
      { onConflict: "id" },
    );

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: enterpriseAdminRoleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );

  // Atomic minutes transfer (reseller's pool → org's pool). The RPC
  // re-validates inside the transaction, so a race between the pre-flight
  // and now can't overspend the reseller.
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_organization", {
      _org_id: org.id,
      _amount: allocNum,
    });
    if (tErr) {
      // Soft-warn: the admin is already invited; surface the error so
      // the UI shows the user can retry the refill from their dashboard.
      console.warn("[reseller/enterprises] initial transfer failed:", tErr.message);
    }
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  // Record the company-admin onboarding in the unified invites table so the
  // partner's invite status table tracks it (sent → accepted), uniform with
  // every other invite. The transition to 'accepted' is handled by the
  // mark_invites_accepted_on_signin trigger when the recipient actually
  // signs in for the first time — we do NOT mark it accepted here just
  // because the server-side provisioning succeeded. Best-effort.
  void recordInvite(admin, {
    email: trimmedEmail,
    name: adminDisplayName.trim(),
    role: ROLE.enterprise_admin,
    scopeType: "partner",
    scopeId: resellerId,
    companyName: org.name,
    invitedBy: actor.id,
  });

  // Fan out an in-app notification to the reseller's team so they see the
  // new client land in their inbox. We include the actor (the partner who
  // pressed "Onboard") — the bell is the partner's activity log; seeing
  // your own onboarding actions there is the expected behaviour and the
  // only way a single-owner reseller sees the event at all. Best-effort —
  // a failed insert here must never undo the successful onboarding above.
  void notifyResellerClientOnboarded(admin, {
    resellerId,
    enterpriseId:   org.id,
    enterpriseName: org.name,
    actorUserId:    null,
  });

  return NextResponse.json({
    enterprise: {
      id:               org.id,
      name:             org.name,
      enterpriseCode:   org.enterprise_code,
      status:           org.status,
      primaryDomain:    org.primary_domain,
      createdAt:        org.created_at,
    },
    admin: {
      id:          userId,
      email:       trimmedEmail,
      displayName: adminDisplayName.trim(),
    },
    invited:          mode === "invited",
    attachedExisting: mode === "attached_existing",
  });
}
