/*
 * Reseller internal team members.
 *
 * GET  /api/reseller/team-members         → owner + team list (active + invited).
 * POST /api/reseller/team-members         → add by email. If a profile exists
 *                                            with that email we link them
 *                                            immediately (profile.reseller_id
 *                                            set, row status='active'). If
 *                                            not, we create an invited row.
 *
 * Role values ('manager' | 'analyst' | 'admin') are labels-only for now —
 * the schema enforces the enum but no RBAC tier is applied. Layering real
 * permissions later is a non-breaking change.
 */

import { NextResponse } from "next/server";
import { requireReseller } from "@/lib/reseller-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleLabel = "manager" | "analyst" | "admin";
const ALLOWED_ROLES: ReadonlySet<RoleLabel> = new Set(["manager", "analyst", "admin"]);

type TeamMemberRow = {
  id:           string;
  email:        string;
  full_name:    string | null;
  role:         RoleLabel;
  status:       "invited" | "active" | "removed";
  user_id:      string | null;
  invited_at:   string;
  accepted_at:  string | null;
};

type ResellerRow = { owner_user_id: string | null };

type AuthUser = { id: string; email?: string | null };

export async function GET() {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId } = gate;

  const [{ data: reseller, error: rErr }, { data: members, error: mErr }] = await Promise.all([
    admin
      .from("resellers")
      .select("owner_user_id")
      .eq("id", resellerId)
      .maybeSingle<ResellerRow>(),
    admin
      .from("reseller_team_members")
      .select("id, email, full_name, role, status, user_id, invited_at, accepted_at")
      .eq("reseller_id", resellerId)
      .neq("status", "removed")
      .order("invited_at", { ascending: true })
      .returns<TeamMemberRow[]>(),
  ]);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  // Synthesise the owner from auth.users (their email lives there, not on profiles).
  let owner: { id: string; email: string; fullName: string | null } | null = null;
  if (reseller?.owner_user_id) {
    const { data: ownerUser } = await admin.auth.admin.getUserById(reseller.owner_user_id);
    const u = ownerUser?.user as AuthUser | null;
    if (u) {
      const { data: ownerProfile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", u.id)
        .maybeSingle<{ full_name: string | null }>();
      owner = { id: u.id, email: u.email ?? "", fullName: ownerProfile?.full_name ?? null };
    }
  }

  const team = (members ?? []).map((m) => ({
    id:         m.id,
    email:      m.email,
    fullName:   m.full_name,
    role:       m.role,
    status:     m.status,
    userId:     m.user_id,
    invitedAt:  m.invited_at,
    acceptedAt: m.accepted_at,
  }));

  return NextResponse.json({ owner, team });
}

export async function POST(request: Request) {
  const gate = await requireReseller();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, resellerId, user } = gate;

  const body = (await request.json().catch(() => ({}))) as {
    email?:    string;
    fullName?: string;
    role?:     string;
  };

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const role: RoleLabel = ALLOWED_ROLES.has(body.role as RoleLabel)
    ? (body.role as RoleLabel)
    : "manager";
  const fullName = (body.fullName ?? "").trim() || null;

  // Refuse to add the owner themselves as a team member.
  if (user.email && user.email.toLowerCase() === email) {
    return NextResponse.json({ error: "is_owner" }, { status: 400 });
  }

  // Try to resolve an existing user by email (auth.users — profiles has no email).
  // listUsers() with a filter is bounded; for a single-tenant team list this is
  // fine. If the team scales beyond ~1000 members the lookup can move to a
  // dedicated RPC indexed on auth.users.email.
  let existingUserId: string | null = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = (data?.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === email,
    );
    if (match) existingUserId = match.id;
  } catch {
    /* Best effort. If the lookup fails we fall through to invited status. */
  }

  // If they already belong to a DIFFERENT reseller we refuse, so we don't yank
  // a teammate out from under another partner.
  if (existingUserId) {
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("reseller_id")
      .eq("id", existingUserId)
      .maybeSingle<{ reseller_id: string | null }>();
    if (existingProfile?.reseller_id && existingProfile.reseller_id !== resellerId) {
      return NextResponse.json({ error: "user_in_other_reseller" }, { status: 409 });
    }
  }

  const status: "invited" | "active" = existingUserId ? "active" : "invited";

  const { data: inserted, error } = await admin
    .from("reseller_team_members")
    .insert({
      reseller_id: resellerId,
      email,
      full_name:   fullName,
      role,
      status,
      user_id:     existingUserId,
      invited_by:  user.id,
      accepted_at: existingUserId ? new Date().toISOString() : null,
    })
    .select("id, email, full_name, role, status, user_id, invited_at, accepted_at")
    .single<TeamMemberRow>();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "already_in_team" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If they have an account, link their profile to this reseller so the
  // existing requireReseller() gate works for them automatically.
  if (existingUserId) {
    await admin
      .from("profiles")
      .update({ reseller_id: resellerId })
      .eq("id", existingUserId);
  }

  return NextResponse.json({
    member: {
      id:         inserted.id,
      email:      inserted.email,
      fullName:   inserted.full_name,
      role:       inserted.role,
      status:     inserted.status,
      userId:     inserted.user_id,
      invitedAt:  inserted.invited_at,
      acceptedAt: inserted.accepted_at,
    },
  });
}
