/*
 * Shared reseller provisioning — the single path that turns a name+email into
 * a live channel partner: a resellers row (reseller_code filled by the DB
 * trigger), a /partner login invite, profile link, reseller role grant, owner
 * back-link, and an optional initial minutes transfer.
 *
 * Extracted from app/api/admin/resellers/route.ts so BOTH super-admin manual
 * creation AND partner-application approval call the exact same code. Approve
 * must not reinvent provisioning (brief: "reuse the existing reseller-creation
 * path").
 *
 * Idempotency / dup behaviour is the caller's choice via `onExisting`:
 *   - "error": a reseller already on this email is a 409 (manual create).
 *   - "link":  return the existing reseller untouched (approve — so a second
 *              approval, or an email already provisioned manually, never
 *              creates a duplicate reseller).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendInvitationEmail } from "@/lib/admin-invite";
import { ROLE } from "@/lib/relay/roles";

export type ProvisionResellerInput = {
  name: string;
  email: string;
  /** 0–100; caller validates. Defaults applied upstream (20% for new). */
  commission: number;
  /** Initial minutes to credit via transfer_to_reseller. Default 0. */
  allocatedMinutes?: number;
  /** acting user id, recorded as created_by_user_id. */
  actorId: string;
  /** What to do if a reseller already exists for this email. */
  onExisting: "error" | "link";
};

export type ProvisionedReseller = {
  id: string;
  name: string;
  email: string | null;
  resellerCode: string;
  commission: number;
  status: string;
  createdAt: string;
};

export type ProvisionResult =
  | {
      ok: true;
      reseller: ProvisionedReseller;
      userId: string | null;
      /** invited = new auth user; attached_existing = existing user linked;
       *  existing = a reseller already existed and was returned as-is. */
      mode: "invited" | "attached_existing" | "existing";
    }
  | { ok: false; status: number; error: string };

function shape(r: {
  id: string;
  name: string;
  email: string | null;
  reseller_code: string;
  commission: number | null;
  status: string;
  created_at: string;
}): ProvisionedReseller {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    resellerCode: r.reseller_code,
    commission: Number(r.commission ?? 0),
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function provisionReseller(
  admin: SupabaseClient,
  input: ProvisionResellerInput
): Promise<ProvisionResult> {
  const cleanEmail = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const allocNum = Number(input.allocatedMinutes ?? 0);

  // Already a reseller for this email? Honour the caller's policy.
  const { data: existing } = await admin
    .from("resellers")
    .select("id, name, email, reseller_code, commission, status, created_at")
    .ilike("email", cleanEmail)
    .maybeSingle();
  if (existing) {
    if (input.onExisting === "error") {
      return {
        ok: false,
        status: 409,
        error: "A reseller with this email already exists.",
      };
    }
    // "link" — return the existing reseller; do NOT create a duplicate.
    const { data: ownerRow } = await admin
      .from("resellers")
      .select("owner_user_id")
      .eq("id", (existing as { id: string }).id)
      .maybeSingle();
    return {
      ok: true,
      reseller: shape(existing as Parameters<typeof shape>[0]),
      userId:
        (ownerRow as { owner_user_id: string | null } | null)?.owner_user_id ??
        null,
      mode: "existing",
    };
  }

  // Insert the reseller row. The set-code trigger fills reseller_code in the
  // RLC-AB12CD format. Minutes columns stay at 0 until refill.
  const { data: resellerData, error: insertErr } = await admin
    .from("resellers")
    .insert({
      name,
      email: cleanEmail,
      commission: input.commission,
      status: "active",
      created_by_user_id: input.actorId,
    })
    .select("id, name, email, reseller_code, commission, status, created_at")
    .single();
  if (insertErr || !resellerData) {
    return {
      ok: false,
      status: 400,
      error: insertErr?.message ?? "Couldn't create reseller.",
    };
  }
  const reseller = resellerData as Parameters<typeof shape>[0];

  // Send the Supabase invite (creates the auth user if new; magic-link
  // fallback for existing-confirmed users).
  const invite = await sendInvitationEmail(admin, {
    email: cleanEmail,
    displayName: name,
    metadata: {
      role_label: "reseller",
      reseller_id: reseller.id,
      reseller_code: reseller.reseller_code,
      allocated_minutes: allocNum,
      created_by: input.actorId,
    },
  });
  if (!invite.ok) {
    await admin.from("resellers").delete().eq("id", reseller.id);
    return { ok: false, status: 400, error: invite.error };
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
    return {
      ok: false,
      status: 500,
      error:
        "Reseller invited but auth row not yet visible — try again in a moment.",
    };
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
    return { ok: false, status: 500, error: "reseller role not seeded" };
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
    : name;

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
    return { ok: false, status: 500, error: profileErr.message };
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

  // Initial minutes allocation via the RPC (atomic, validates ≥ 0). Soft-warn
  // on failure — the reseller exists and is invited; minutes can be retried.
  if (allocNum > 0) {
    const { error: tErr } = await admin.rpc("transfer_to_reseller", {
      _reseller_id: reseller.id,
      _amount: allocNum,
    });
    if (tErr) {
      console.warn(
        "[provisionReseller] initial transfer failed:",
        tErr.message
      );
    }
  }

  return {
    ok: true,
    reseller: shape(reseller),
    userId,
    mode: invite.mode === "invited" ? "invited" : "attached_existing",
  };
}
