/*
 * Reseller-route auth helper.
 *
 * Gate for /api/reseller/* routes. Asserts the cookie-bearing caller holds
 * the reseller role AND has a reseller_id on their profile, then returns:
 *   - user, supabase (cookie scope), admin (service role)
 *   - resellerId resolved from their profile (so route handlers never
 *     have to re-fetch it or trust client-supplied ids)
 *
 * Service role bypasses RLS — we always scope queries by `resellerId` here
 * to prevent cross-reseller reads/writes.
 */

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ROLE } from "@/lib/relay/roles";

export type ResellerGate =
  | { ok: false; status: 401 | 403; error: string }
  | {
      ok: true;
      user: User;
      resellerId: string;
      supabase: SupabaseClient;
      admin: SupabaseClient;
    };

export async function requireReseller(): Promise<ResellerGate> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "not_signed_in" };

  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_role_names").select("role").eq("user_id", user.id),
    supabase
      .from("profiles")
      .select("reseller_id")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const isReseller = (roles ?? []).some(
    (r: { role: string }) => r.role === ROLE.reseller
  );
  if (!isReseller) return { ok: false, status: 403, error: "forbidden" };

  const resellerId = (profile as { reseller_id?: string } | null)?.reseller_id;
  if (!resellerId) return { ok: false, status: 403, error: "no_reseller" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, status: 401, error: "service_role_not_configured" };
  }

  const admin = createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { ok: true, user, resellerId, supabase, admin };
}
