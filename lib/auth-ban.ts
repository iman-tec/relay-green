/*
 * Auth-side ban / unban helpers for deactivation cascades.
 *
 * The deactivate_X PL/pgSQL RPCs set profile.status='suspended' and return
 * remaining minutes upward, but they don't touch Supabase auth — so the
 * suspended user could still sign in via /api/auth/signin-password.
 *
 * The PATCH endpoints that flip status pair their RPC call with these
 * helpers so "deactivate" really does block login per spec.
 *
 * We use a 100-year ban as the "forever" sentinel (Supabase requires a
 * duration string). To reactivate, pass `"none"` which clears banned_until.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const FOREVER = "876000h"; // ~100 years
const LIFT = "none";

/** Ban a single auth user; swallow per-user errors so a half-failure
 *  doesn't leak the caller's progress. */
export async function banUser(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  if (!userId) return;
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: FOREVER,
  });
  if (error) {
    console.warn(`[auth-ban] ban failed for ${userId}: ${error.message}`);
  }
}

/** Ban many users in parallel. */
export async function banUsers(
  admin: SupabaseClient,
  ids: readonly string[]
): Promise<void> {
  await Promise.all(ids.filter(Boolean).map((id) => banUser(admin, id)));
}

/** Lift the ban on a single auth user. */
export async function unbanUser(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  if (!userId) return;
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: LIFT,
  });
  if (error) {
    console.warn(`[auth-ban] unban failed for ${userId}: ${error.message}`);
  }
}
