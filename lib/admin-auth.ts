/*
 * Admin-route auth helpers.
 *
 * - requireSuperAdmin(): asserts the cookie-bearing caller has the
 *   super_admin role and returns both a user-scoped client (for audit
 *   reads/inserts) and an elevated service-role client (for auth.admin.*
 *   and DDL-adjacent ops).
 *
 * Service role bypasses RLS, so we deliberately gate every entry point
 * behind a role check before exposing it.
 */

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export type RequireResult =
  | { ok: false; status: 401 | 403; error: string }
  | {
      ok: true;
      user: User;
      supabase: SupabaseClient;
      admin: SupabaseClient;
    };

export async function requireSuperAdmin(): Promise<RequireResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "not_signed_in" };

  const { data: roles } = await supabase
    .from("user_role_names")
    .select("role")
    .eq("user_id", user.id);
  const isSuperAdmin = (roles ?? []).some(
    (r: { role: string }) => r.role === ROLE.super_admin
  );
  if (!isSuperAdmin) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 401, error: "service_role_not_configured" };
  }

  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { ok: true, user, supabase, admin };
}
