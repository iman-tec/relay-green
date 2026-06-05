/*
 * Department-admin auth helper.
 *
 * Gate for /api/department/* routes. Asserts the cookie-bearing caller
 * holds the department_admin role AND has both a department_id and an
 * organization_id on their profile, then returns:
 *   - user, supabase (cookie scope), admin (service role)
 *   - departmentId resolved from their profile
 *   - orgId resolved from their profile (for cross-checks)
 *
 * Service role bypasses RLS — we always scope queries by `departmentId`
 * here to prevent cross-department reads/writes.
 */

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export type DepartmentGate =
  | { ok: false; status: 401 | 403; error: string }
  | {
      ok: true;
      user: User;
      departmentId: string;
      orgId: string;
      supabase: SupabaseClient;
      admin: SupabaseClient;
    };

export async function requireDepartmentAdmin(): Promise<DepartmentGate> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "not_signed_in" };

  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_role_names").select("role").eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("department_id, organization_id")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const isDeptAdmin = (roles ?? []).some(
    (r: { role: string }) => r.role === ROLE.department_admin
  );
  if (!isDeptAdmin) return { ok: false, status: 403, error: "forbidden" };

  const p = profile as {
    department_id?: string;
    organization_id?: string;
  } | null;
  const departmentId = p?.department_id;
  const orgId = p?.organization_id;
  if (!departmentId) return { ok: false, status: 403, error: "no_department" };
  if (!orgId) return { ok: false, status: 403, error: "no_organization" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 401, error: "service_role_not_configured" };
  }

  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { ok: true, user, departmentId, orgId, supabase, admin };
}
