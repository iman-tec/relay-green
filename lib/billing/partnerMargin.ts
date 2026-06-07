/*
 * Channel Partner billing math — the single source of truth for how a partner
 * wholesale discount turns into (a) what the enterprise pays at checkout and
 * (b) what margin accrues to the partner.
 *
 * Pricing is minutes-only (fixed bundles, see ./minuteBundles). There is no
 * per-org rate column, so the discount is applied to the BUNDLE PRICE at Stripe
 * checkout — the minute-crediting RPC is never touched (minutes still credit
 * 1:1). Two percentages, both already stored on existing rows:
 *
 *   wholesale  = resellers.commission         (Relay → partner, off list)
 *   passthrough = organizations.discount_pct   (partner → enterprise)
 *
 * Invariant (enforced server-side at onboarding): passthrough <= wholesale.
 *
 * Margin base = NET (the discounted price the enterprise actually pays), per
 * the locked product decision. So for a bundle of list price L:
 *
 *   net (enterprise pays) = L · (1 − passthrough)
 *   partner earned        = (wholesale − passthrough) · net
 *                         = (wholesale − passthrough) · L · (1 − passthrough)
 *
 * Worked example — Team bundle L = €5,700, wholesale 20%, passthrough 10%:
 *   net    = 570000 · 0.90 = €5,130
 *   earned = 0.10 · 513000 = €513
 */

/** A partner discount is active when there's a positive passthrough and the
 *  window hasn't closed. NULL `discountUntil` means no expiry. */
export function isDiscountActive(
  discountPct: number,
  discountUntil: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!(discountPct > 0)) return false;
  if (!discountUntil) return true;
  return new Date(discountUntil) > now;
}

/** The amount (EUR cents) to charge for a bundle after the passthrough
 *  discount. Returns the list `amountCents` unchanged when the discount is
 *  inactive — so non-partner orgs are a strict no-op. Floors to whole cents. */
export function effectiveBundleCents(
  amountCents: number,
  discountPct: number,
  discountUntil: string | null | undefined,
  now: Date = new Date()
): number {
  if (!isDiscountActive(discountPct, discountUntil, now)) return amountCents;
  const pct = Math.max(0, Math.min(100, discountPct));
  return Math.floor(amountCents * (1 - pct / 100));
}

/** Partner margin (EUR cents) accrued from one bundle recharge, on the NET base.
 *  Clamps to 0 if passthrough exceeds wholesale (should be impossible given the
 *  server-side guard, but never accrue negative margin). */
export function partnerEarnedCents(args: {
  /** list bundle price in EUR cents (pre-discount) */
  listAmountCents: number;
  /** resellers.commission — wholesale % off list, 0–100 */
  wholesalePct: number;
  /** organizations.discount_pct — passthrough % to the enterprise, 0–100 */
  passthroughPct: number;
}): number {
  const wholesale = Math.max(0, Math.min(100, args.wholesalePct)) / 100;
  const passthrough = Math.max(0, Math.min(100, args.passthroughPct)) / 100;
  const marginRate = wholesale - passthrough;
  if (marginRate <= 0) return 0;
  const netCents = args.listAmountCents * (1 - passthrough);
  return Math.round(marginRate * netCents);
}
