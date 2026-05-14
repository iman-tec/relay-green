/*
 * Org-admin auth helper.
 *
 * Gate for /api/enterprise/* and /api/internal/* routes. Asserts the
 * caller holds either enterprise_admin OR ops_manager (Internal Admin)
 * AND has an organization_id on their profile, then returns:
 *   - user, supabase (cookie scope), admin (service role)
 *   - orgId resolved from their profile (so route handlers never have to
 *     re-fetch it or trust client-supplied org ids)
 *
 * Service role bypasses RLS — we always scope queries by `orgId` here to
 * prevent cross-org reads/writes.
 */

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type EnterpriseGate =
  | { ok: false; status: 401 | 403; error: string }
  | {
      ok: true;
      user: User;
      orgId: string;
      supabase: SupabaseClient;
      admin: SupabaseClient;
    };

export async function requireEnterpriseAdmin(): Promise<EnterpriseGate> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "not_signed_in" };

  // Caller must hold enterprise_admin OR ops_manager AND have an org.
  // Super_admin is NOT accepted here — they have their own console at /admin.
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle(),
  ]);

  const isOrgAdmin = (roles ?? []).some(
    (r: { role: string }) => r.role === "enterprise_admin" || r.role === "ops_manager",
  );
  if (!isOrgAdmin) return { ok: false, status: 403, error: "forbidden" };

  const orgId = (profile as { organization_id?: string } | null)?.organization_id;
  if (!orgId) return { ok: false, status: 403, error: "no_organization" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 401, error: "service_role_not_configured" };
  }

  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { ok: true, user, orgId, supabase, admin };
}
