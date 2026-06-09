/*
 * Department-scoped employees — list + create.
 *
 * GET  /api/department/employees
 *   Returns the calling department admin's dept KPIs + the list of
 *   employees in that department (with auth info: email, status).
 *
 * POST /api/department/employees
 *   Body: { name, email, allocatedMinutes?, status? }  status defaults 'active'
 *   Creates an employee profile under this dept (client_type='employee',
 *   organization_id + department_id set), grants the 'client' role,
 *   transfers initial minutes via transfer_to_employee, and sends the
 *   spec-required invitation email with the department_code in metadata.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireDepartmentAdmin } from "@/lib/department-auth";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { recordInvite } from "@/lib/relay/invites";
import { convertIndividualReferralOnOrgJoin } from "@/lib/billing/individualReferral";
import { deriveMemberStatus } from "@/lib/relay/memberStatus";
import { ROLE } from "@/lib/relay/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, departmentId, orgId } = gate;

  const [{ data: dept }, { data: org }, { data: profileRows }] =
    await Promise.all([
      admin
        .from("departments")
        .select(
          "id, name, department_code, status, allocated_minutes, used_minutes, remaining_minutes"
        )
        .eq("id", departmentId)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("id, name, enterprise_code")
        .eq("id", orgId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select(
          "id, full_name, client_type, status, allocated_minutes, used_minutes, remaining_minutes, created_at"
        )
        .eq("department_id", departmentId)
        // Only employees — the dept admin sits in the same department but
        // shouldn't appear in their own employees list.
        .eq("client_type", "employee"),
    ]);

  if (!dept)
    return NextResponse.json({ error: "department missing" }, { status: 500 });
  if (!org) return NextResponse.json({ error: "org missing" }, { status: 500 });

  const profileIds = (profileRows ?? []).map((p: { id: string }) => p.id);
  // Auth rows give email + the status signals: a member is Invited until they
  // first sign in (last_sign_in_at null), Active after, Suspended when banned.
  const authById = new Map<
    string,
    { email: string; lastSignIn: string | null; banned: boolean }
  >();
  if (profileIds.length) {
    const { data: authPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of authPage?.users ?? []) {
      if (u.id && profileIds.includes(u.id)) {
        authById.set(u.id, {
          email: u.email ?? "",
          lastSignIn: u.last_sign_in_at ?? null,
          banned: Boolean(
            u.banned_until && new Date(u.banned_until) > new Date()
          ),
        });
      }
    }
  }

  const d = dept as {
    id: string;
    name: string;
    department_code: string;
    status: string;
    allocated_minutes: number;
    used_minutes: number;
    remaining_minutes: number;
  };
  const o = org as { id: string; name: string; enterprise_code: string };

  return NextResponse.json({
    department: {
      id: d.id,
      name: d.name,
      departmentCode: d.department_code,
      status: d.status,
      allocatedMinutes: Number(d.allocated_minutes ?? 0),
      usedMinutes: Number(d.used_minutes ?? 0),
      remainingMinutes: Number(d.remaining_minutes ?? 0),
    },
    enterprise: {
      id: o.id,
      name: o.name,
      enterpriseCode: o.enterprise_code,
    },
    employees: (
      (profileRows as Array<{
        id: string;
        full_name: string | null;
        client_type: string;
        status: string;
        allocated_minutes: number;
        used_minutes: number;
        remaining_minutes: number;
        created_at: string;
      }>) ?? []
    ).map((p) => {
      const a = authById.get(p.id);
      const status = deriveMemberStatus(Boolean(a?.banned), a?.lastSignIn);
      return {
        id: p.id,
        displayName: p.full_name ?? "",
        email: a?.email ?? "",
        clientType: p.client_type,
        status,
        allocatedMinutes: Number(p.allocated_minutes ?? 0),
        usedMinutes: Number(p.used_minutes ?? 0),
        remainingMinutes: Number(p.remaining_minutes ?? 0),
        createdAt: p.created_at,
      };
    }),
  });
}

type EmpInput = {
  name?: string;
  email?: string;
  allocatedMinutes?: number | string;
};
type EmpResult =
  | {
      ok: true;
      userId: string;
      email: string;
      name: string;
      departmentCode: string;
      mode: "invited" | "attached_existing";
    }
  | { ok: false; status: number; error: string };

/** Invite + provision ONE employee into the department. Shared by single + bulk POST. */
async function provisionEmployee(
  admin: SupabaseClient,
  departmentId: string,
  orgId: string,
  actorId: string,
  input: EmpInput
): Promise<EmpResult> {
  const { name, email, allocatedMinutes } = input;

  if (!name?.trim() || !email?.trim()) {
    return { ok: false, status: 400, error: "Need name and email." };
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
    return { ok: false, status: 400, error: "Invalid email." };
  }
  const allocNum = Number(allocatedMinutes ?? 0);
  if (Number.isNaN(allocNum) || allocNum < 0) {
    return {
      ok: false,
      status: 400,
      error: "Allocation must be non-negative.",
    };
  }

  // Pre-flight: dept must be active and have enough remaining.
  const { data: deptRow } = await admin
    .from("departments")
    .select("id, name, department_code, status, remaining_minutes")
    .eq("id", departmentId)
    .maybeSingle();
  if (!deptRow) return { ok: false, status: 500, error: "department missing" };
  const dept = deptRow as {
    id: string;
    name: string;
    department_code: string;
    status: string;
    remaining_minutes: number;
  };
  if (dept.status !== "active") {
    return { ok: false, status: 403, error: "Department is not active." };
  }
  if (allocNum > Number(dept.remaining_minutes ?? 0)) {
    return {
      ok: false,
      status: 400,
      error: `Allocation exceeds the department's remaining minutes (${dept.remaining_minutes}).`,
    };
  }

  // Lookup enterprise (for the invite metadata).
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id, name, enterprise_code")
    .eq("id", orgId)
    .maybeSingle();
  const org = orgRow as {
    id: string;
    name: string;
    enterprise_code: string;
  } | null;

  // Send invite. Employees enter the DEPARTMENT_CODE on first login;
  // template shows it under the "enter on first sign-in" label.
  const invite = await sendInvitationEmail(admin, {
    email: trimmedEmail,
    displayName: name.trim(),
    metadata: {
      role_label: "employee",
      organization_id: orgId,
      org_name: org?.name,
      enterprise_code: org?.enterprise_code,
      department_id: dept.id,
      department_code: dept.department_code,
      allocated_minutes: allocNum,
      created_by: actorId,
    },
  });
  if (!invite.ok) {
    return { ok: false, status: 400, error: invite.error ?? "Invite failed." };
  }

  let userId = invite.userId ?? null;
  if (!userId) {
    const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId =
      lookup.data?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)
        ?.id ?? null;
  }
  if (!userId) {
    return {
      ok: false,
      status: 500,
      error:
        "Employee invited but auth row not yet visible — try again in a moment.",
    };
  }

  // Resolve client role_id (employees reuse the client surface per spec).
  const { data: roleRow } = await admin
    .from("roles")
    .select("id")
    .eq("name", ROLE.client)
    .maybeSingle();
  const roleId = (roleRow as { id: string } | null)?.id;
  if (!roleId) {
    return { ok: false, status: 500, error: "client role not seeded" };
  }

  // Enforce 'one department per employee': if the email already belongs
  // to a profile attached to a DIFFERENT department, refuse rather than
  // silently move them.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, department_id, organization_id, full_name, primary_role_id")
    .eq("id", userId)
    .maybeSingle();
  const ep = existingProfile as {
    id: string;
    department_id: string | null;
    organization_id: string | null;
    full_name: string | null;
    primary_role_id: string | null;
  } | null;
  if (ep?.department_id && ep.department_id !== departmentId) {
    return {
      ok: false,
      status: 409,
      error: "This employee already belongs to another department.",
    };
  }

  await admin.from("profiles").upsert(
    {
      id: userId,
      full_name: ep?.full_name?.trim() ? ep.full_name : name.trim(),
      primary_role_id: ep?.primary_role_id ?? roleId,
      organization_id: orgId,
      department_id: departmentId,
      client_type: "employee",
      is_onboarded: true,
    },
    { onConflict: "id" }
  );

  await admin
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: roleId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true }
    );

  // If this email was an attributed individual referral, joining a department
  // converts it (CP commission stops). Best-effort, idempotent.
  await convertIndividualReferralOnOrgJoin(admin, userId);

  // Atomic transfer (dept pool → employee pool). RPC re-validates.
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_employee", {
      _profile_id: userId,
      _amount: allocNum,
    });
    if (tErr) {
      console.warn(
        "[department/employees] initial transfer failed:",
        tErr.message
      );
    }
  }

  const mode = invite.mode === "invited" ? "invited" : "attached_existing";

  return {
    ok: true,
    userId,
    email: trimmedEmail,
    name: name.trim(),
    departmentCode: dept.department_code,
    mode,
  };
}

export async function POST(request: Request) {
  const gate = await requireDepartmentAdmin();
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, user: actor, departmentId, orgId } = gate;

  const body = (await request.json().catch(() => ({}))) as EmpInput & {
    recipients?: Array<{
      email?: string;
      name?: string;
      displayName?: string;
      allocatedMinutes?: number | string;
    }>;
  };

  // Record a department-scoped invite row so the shared status table tracks it.
  const track = async (email: string, name: string) => {
    await recordInvite(admin, {
      email,
      name,
      role: ROLE.client,
      scopeType: "department",
      scopeId: departmentId,
      departmentId,
      invitedBy: actor.id,
    }).catch(() => {});
  };

  // Bulk path — shared InviteFlow posts { recipients: [...] }. Bulk invites
  // carry no per-employee allocation (managers refill from the pool later).
  if (Array.isArray(body.recipients)) {
    const recipients = body.recipients.filter(
      (r) => r.email && r.email.includes("@")
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

    const results: Array<{ email: string; ok: boolean; error?: string }> = [];
    for (const rec of recipients) {
      const email = rec.email!.trim().toLowerCase();
      const name = (rec.displayName ?? rec.name ?? email.split("@")[0]).trim();
      const res = await provisionEmployee(
        admin,
        departmentId,
        orgId,
        actor.id,
        { name, email, allocatedMinutes: 0 }
      );
      if (res.ok) {
        await track(email, name);
        results.push({ email, ok: true });
      } else results.push({ email, ok: false, error: res.error });
    }
    return NextResponse.json({
      sent: results.filter((r) => r.ok).length,
      total: recipients.length,
      results,
    });
  }

  // Legacy single path — { name, email, allocatedMinutes? }.
  const res = await provisionEmployee(
    admin,
    departmentId,
    orgId,
    actor.id,
    body
  );
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });
  await track(res.email, res.name);
  return NextResponse.json({
    employee: { id: res.userId, displayName: res.name, email: res.email },
    department: { id: departmentId, departmentCode: res.departmentCode },
    invited: res.mode === "invited",
    attachedExisting: res.mode === "attached_existing",
  });
}
