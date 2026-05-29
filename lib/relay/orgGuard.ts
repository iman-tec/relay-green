/*
 * Cross-org guard for user provisioning.
 *
 * A user belongs to at most one enterprise (profiles.organization_id). The
 * admin/enterprise provisioning forms invite by email and then upsert the
 * profile's organization_id / department_id — which would silently MOVE an
 * existing user from their current enterprise into the new one (and strip
 * their old admin role). That's never what the operator intends.
 *
 * Call this BEFORE inviting/upserting: if the email resolves to a user who
 * already belongs to a DIFFERENT org, block the operation with a clear
 * message instead of hijacking them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function findUserInAnotherOrg(
  admin: SupabaseClient,
  email: string,
  targetOrgId: string,
): Promise<{ blocked: boolean; orgName: string | null }> {
  const lower = email.trim().toLowerCase();
  if (!lower) return { blocked: false, orgName: null };

  let userId: string | null = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === lower)?.id ?? null;
  } catch {
    // If the lookup fails we don't block — the downstream upsert still runs.
    return { blocked: false, orgName: null };
  }
  if (!userId) return { blocked: false, orgName: null };

  const { data: prof } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();
  const otherOrgId = (prof as { organization_id: string | null } | null)?.organization_id ?? null;
  if (otherOrgId && otherOrgId !== targetOrgId) {
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", otherOrgId)
      .maybeSingle();
    return { blocked: true, orgName: (org as { name: string } | null)?.name ?? null };
  }
  return { blocked: false, orgName: null };
}

/** Standard message for a blocked cross-org provisioning attempt. */
export function crossOrgError(orgName: string | null): string {
  return orgName
    ? `That email already belongs to ${orgName}. Remove them there first, or use a different email.`
    : "That email already belongs to another enterprise. Remove them there first, or use a different email.";
}
