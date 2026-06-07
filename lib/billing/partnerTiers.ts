/*
 * Channel Partner tiers — TWO only (locked decision). Tier is COMPUTED from a
 * single transparent metric: monthly book spend (the sum of active companies'
 * net billed usage this month). Higher tier → larger wholesale discount + perks.
 *
 * Pure module (no node/react) — safe on server and client.
 */

export type PartnerTier = "partner" | "premier";

/** €25,000 of monthly book → Premier. The one threshold; transparent on purpose. */
export const PREMIER_MONTHLY_BOOK_CENTS = 2_500_000;

export const TIER_LABEL: Record<PartnerTier, string> = {
  partner: "Partner",
  premier: "Premier",
};

export function tierFromMonthlyBookCents(cents: number): PartnerTier {
  return cents >= PREMIER_MONTHLY_BOOK_CENTS ? "premier" : "partner";
}

/** Cents still needed this month to reach Premier (0 if already there). */
export function centsToPremier(monthlyBookCents: number): number {
  return Math.max(0, PREMIER_MONTHLY_BOOK_CENTS - monthlyBookCents);
}

/** 0–1 progress toward Premier, for the bar. */
export function premierProgress(monthlyBookCents: number): number {
  return Math.max(
    0,
    Math.min(1, monthlyBookCents / PREMIER_MONTHLY_BOOK_CENTS)
  );
}
