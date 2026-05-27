/*
 * Prepaid minute bundles for the Enterprise wallet. Pay-per-minute, no
 * subscription — buying a bundle tops up the company's prepaid minute pool
 * (organizations.allocated_minutes / remaining_minutes).
 *
 * Larger bundles carry a small volume discount on the €3.00/min list rate.
 * Amounts are EUR cents; minutes are whole minutes.
 */

export type MinuteBundle = {
  code: string;
  label: string;
  minutes: number;
  amountCents: number;
};

export const LIST_CENTS_PER_MINUTE = 300;

export const MINUTE_BUNDLES: readonly MinuteBundle[] = [
  { code: "starter", label: "Starter", minutes: 500,    amountCents: 500 * 300 },          // €3.00/min
  { code: "team",    label: "Team",    minutes: 2_000,  amountCents: Math.round(2_000 * 285) }, // €2.85/min
  { code: "scale",   label: "Scale",   minutes: 10_000, amountCents: Math.round(10_000 * 270) }, // €2.70/min
];

export function bundleByCode(code: string): MinuteBundle | undefined {
  return MINUTE_BUNDLES.find((b) => b.code === code);
}

export function perMinuteCents(b: MinuteBundle): number {
  return Math.round(b.amountCents / b.minutes);
}
