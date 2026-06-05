/*
 * Unified invite endpoint — the shared onboarding primitive's backend.
 *
 * GET  /api/invite   → invites for the caller's scope (status table).
 * POST /api/invite   → invite one or many recipients into the caller's scope.
 *
 * Scope is resolved from the caller's role (never trusted from the client):
 *   reseller         → partner    (their reseller id)        — internal users
 *   enterprise_admin → company    (their organization id)    — admins / members
 *   department_admin → department (their department id)      — members
 *
 * Each recipient gets a recorded invite row + a coded single-use link, and a
 * branded email via sendInvitationEmail. Company-onboarding by a partner
 * (which also creates the org) stays in /api/reseller/enterprises but records
 * into the same invites table, so the status table is uniform.
 */

import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { recordInvite, type InviteScope } from "@/lib/relay/invites";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Scope = { type: InviteScope; id: string };

async function resolve(): Promise<
  | { ok: false; status: number; error: string }
  | { ok: true; userId: string; scope: Scope; admin: SupabaseClient }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "not_signed_in" };

  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_role_names").select("role").eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("organization_id, department_id, reseller_id")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
  const p = (profile ?? {}) as {
    organization_id?: string;
    department_id?: string;
    reseller_id?: string;
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return { ok: false, status: 500, error: "service_role_not_configured" };
  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let scope: Scope | null = null;
  if (roleSet.has(ROLE.reseller)) {
    // partner scope: their reseller id (owner or profile bind)
    const rid = p.reseller_id ?? null;
    if (rid) scope = { type: "partner", id: rid };
    else {
      const { data: r } = await admin
        .from("resellers")
        .select("id")
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (r) scope = { type: "partner", id: (r as { id: string }).id };
    }
  } else if (roleSet.has(ROLE.enterprise_admin) && p.organization_id) {
    scope = { type: "company", id: p.organization_id };
  } else if (roleSet.has(ROLE.department_admin) && p.department_id) {
    scope = { type: "department", id: p.department_id };
  }
  if (!scope) return { ok: false, status: 403, error: "no_scope" };

  return { ok: true, userId: user.id, scope, admin };
}

export async function GET() {
  const r = await resolve();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { data, error } = await r.admin
    .from("invites")
    .select(
      "id, email, name, role, company_name, status, sent_at, opened_at, accepted_at, expires_at"
    )
    .eq("scope_type", r.scope.type)
    .eq("scope_id", r.scope.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invites: data ?? [] });
}

type Recipient = {
  email?: string;
  name?: string;
  role?: string;
  departmentId?: string;
};

export async function POST(request: Request) {
  const r = await resolve();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { admin, scope, userId } = r;

  const body = (await request.json().catch(() => ({}))) as {
    recipients?: Recipient[];
  };
  const recipients = (body.recipients ?? []).filter(
    (x) => x.email && x.email.includes("@")
  );
  if (recipients.length === 0)
    return NextResponse.json(
      { error: "No valid recipients." },
      { status: 400 }
    );
  if (recipients.length > 500)
    return NextResponse.json(
      { error: "Max 500 recipients per batch." },
      { status: 400 }
    );

  const results: Array<{
    email: string;
    ok: boolean;
    error?: string;
    link?: string;
  }> = [];
  for (const rec of recipients) {
    const email = rec.email!.trim().toLowerCase();
    try {
      // Default role by scope.
      const role =
        rec.role ||
        (scope.type === "company" || scope.type === "department"
          ? ROLE.client
          : "partner_member");
      const inv = await recordInvite(admin, {
        email,
        name: rec.name ?? null,
        role,
        scopeType: scope.type,
        scopeId: scope.id,
        departmentId: rec.departmentId ?? null,
        invitedBy: userId,
      });
      if ("error" in inv) {
        results.push({ email, ok: false, error: inv.error });
        continue;
      }
      // Branded invite email (Supabase delivery). Scope + invite code ride in
      // user_metadata so the claim flow can attach them. // TODO(api): custom
      // white-label template for partner-scope senders.
      await sendInvitationEmail(admin, {
        email,
        displayName: rec.name ?? email.split("@")[0],
        metadata: {
          invite_role: role,
          invite_scope_type: scope.type,
          invite_scope_id: scope.id,
          invite_code: inv.row.code,
        },
      });
      results.push({ email, ok: true, link: inv.link });
    } catch (e) {
      results.push({
        email,
        ok: false,
        error: e instanceof Error ? e.message : "failed",
      });
    }
  }

  const sent = results.filter((x) => x.ok).length;
  return NextResponse.json({ sent, total: recipients.length, results });
}
