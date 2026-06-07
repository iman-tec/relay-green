/*
 * Channel Partner program feature flag.
 *
 * The reimagined partner economics (wholesale discount applied at checkout,
 * margin accrual, payout ledger, new portal) ships behind this flag so the
 * existing `/reseller` surface and — critically — every enterprise's recharge
 * flow stay byte-for-byte unchanged until the program is verified.
 *
 * OFF (default): checkout charges the full bundle price; discount_pct is the
 * display-only promo field it has always been. ON: an active partner discount
 * reduces the Stripe bundle price and margin accrues to the partner.
 *
 * Set NEXT_PUBLIC_PARTNER_PROGRAM=1 (or "true") to enable. Readable on both
 * server and client since it's a NEXT_PUBLIC_ var.
 */

// LAUNCHED: on by default. Kill-switch — set NEXT_PUBLIC_PARTNER_PROGRAM=0
// (or "false") to disable in an environment without a code change.
export function partnerProgramEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_PARTNER_PROGRAM;
  return v !== "0" && v !== "false";
}
