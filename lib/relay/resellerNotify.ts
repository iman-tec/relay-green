/*
 * Reseller in-app notifications.
 *
 * Inserts rows into public.notifications via the create_notification RPC
 * for every linked profile (owner + active team members) of a reseller,
 * gated by per-event prefs in reseller_notification_prefs.
 *
 * Designed for fire-and-forget use from route handlers. All calls are
 * wrapped in try/catch and log on failure — a failed notification must
 * NEVER fail the parent request (e.g. enterprise creation).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientOnboardedArgs = {
  resellerId:     string;
  enterpriseId:   string;
  enterpriseName: string;
  /** User who triggered the action — excluded from the fan-out so they don't notify themselves. */
  actorUserId?:   string | null;
};

/**
 * Fan-out "new client onboarded" notifications to a reseller's team.
 *
 * Read order:
 *   1. reseller_notification_prefs.new_client_onboarded — skip if false.
 *   2. profiles WHERE reseller_id = resellerId            — recipient list.
 *
 * Excludes the actor. Each insert is an independent RPC call; failures
 * are logged but never thrown.
 */
export async function notifyResellerClientOnboarded(
  admin: SupabaseClient,
  args: ClientOnboardedArgs,
): Promise<void> {
  try {
    const { data: prefs } = await admin
      .from("reseller_notification_prefs")
      .select("new_client_onboarded")
      .eq("reseller_id", args.resellerId)
      .maybeSingle<{ new_client_onboarded: boolean }>();
    // Default is "on" — only skip when the row exists AND the toggle is off.
    if (prefs && prefs.new_client_onboarded === false) return;

    const { data: recipients } = await admin
      .from("profiles")
      .select("id")
      .eq("reseller_id", args.resellerId)
      .returns<{ id: string }[]>();

    const ids = (recipients ?? [])
      .map((r) => r.id)
      .filter((id) => !args.actorUserId || id !== args.actorUserId);
    if (ids.length === 0) return;

    const title = `New client onboarded: ${args.enterpriseName}`;
    const body  = "They've been added to your portfolio.";

    await Promise.all(
      ids.map(async (userId) => {
        try {
          await admin.rpc("create_notification", {
            _user_id:    userId,
            _request_id: null,
            _kind:       "client_onboarded",
            _title:      title,
            _body:       body,
          });
        } catch (err) {
          console.warn(
            "[resellerNotify] create_notification failed for user",
            userId,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  } catch (err) {
    console.warn(
      "[resellerNotify] client_onboarded fan-out failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
