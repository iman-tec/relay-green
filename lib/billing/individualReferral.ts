/*
 * Individual-referral attribution (channel-partner program, Phase 2).
 *
 * An organic individual who signs up via a partner's Resources referral link
 * (https://<domain>/?ref=<reseller_code>) is attributed to that partner: the
 * durable link is profiles.reseller_id, plus a dated individual_referrals row
 * that snapshots the 10/10 rates in force at attribution.
 *
 * attributeIndividualReferral() is IDEMPOTENT and heavily guarded — safe to
 * call on every customer OTP verify. It no-ops unless ALL hold:
 *   - a ref code is present,
 *   - it resolves to an ACTIVE reseller,
 *   - the user is ORGANIC (profiles.organization_id IS NULL) — never an
 *     enterprise employee (this is the anti-double-count guard),
 *   - it is not a self-referral (user != reseller owner),
 *   - the user is not already attributed.
 *
 * Callers gate on partnerProgramEnabled() so flag-off is byte-identical.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReferralAttributionResult = {
  attributed: boolean;
  reason?:
    | "no-ref"
    | "no-active-reseller"
    | "self-referral"
    | "no-profile"
    | "enterprise-user"
    | "already-attributed"
    | "error";
};

export async function attributeIndividualReferral(
  admin: SupabaseClient,
  userId: string,
  refCode: string | null | undefined
): Promise<ReferralAttributionResult> {
  const code = (refCode ?? "").trim();
  if (!code) return { attributed: false, reason: "no-ref" };

  // Resolve the reseller by its public code; must be active.
  const { data: reseller } = await admin
    .from("resellers")
    .select(
      "id, owner_user_id, status, individual_referral_discount_pct, individual_referral_commission_pct"
    )
    .eq("reseller_code", code)
    .maybeSingle();
  if (!reseller || reseller.status !== "active")
    return { attributed: false, reason: "no-active-reseller" };

  // Self-referral guard.
  if (reseller.owner_user_id === userId)
    return { attributed: false, reason: "self-referral" };

  // Organic-only: never attribute an enterprise employee (anti-double-count).
  // Idempotency: skip if already linked or already has a referral row.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, organization_id, reseller_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { attributed: false, reason: "no-profile" };
  if (profile.organization_id)
    return { attributed: false, reason: "enterprise-user" };
  if (profile.reseller_id)
    return { attributed: false, reason: "already-attributed" };

  const { data: existing } = await admin
    .from("individual_referrals")
    .select("id")
    .eq("customer_user_id", userId)
    .maybeSingle();
  if (existing) return { attributed: false, reason: "already-attributed" };

  // Durable link + dated attribution row (rates snapshotted).
  await admin
    .from("profiles")
    .update({ reseller_id: reseller.id })
    .eq("id", userId);

  const { error } = await admin.from("individual_referrals").insert({
    reseller_id: reseller.id,
    customer_user_id: userId,
    ref_code: code,
    discount_pct_applied: reseller.individual_referral_discount_pct,
    commission_pct_applied: reseller.individual_referral_commission_pct,
  });
  if (error) {
    // 23505 = raced with a concurrent attribution; treat as done, not an error.
    if ((error as { code?: string }).code === "23505")
      return { attributed: false, reason: "already-attributed" };
    return { attributed: false, reason: "error" };
  }
  return { attributed: true };
}

/*
 * When an attributed individual becomes an enterprise/department member, their
 * referral CONVERTS: future CP commission stops (the anti-double-count rule —
 * an org employee bills from the org pool, not the individual checkout path).
 * Idempotent: only flips a row still in 'active'. Best-effort, money-path-safe
 * (no balance change — it just halts future accrual, which already no-ops on
 * non-active status). Call whenever a profile gains an organization_id.
 */
export async function convertIndividualReferralOnOrgJoin(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  if (!userId) return;
  await admin
    .from("individual_referrals")
    .update({ status: "converted" })
    .eq("customer_user_id", userId)
    .eq("status", "active")
    .then(
      () => {},
      () => {}
    );
}
