/*
 * k-anonymity suppression for member-derived usage aggregates.
 *
 * GDPR data-minimization: any usage figure rolled up from individual members
 * (minutes, sessions, per-period slices) that is backed by fewer than `k`
 * DISTINCT contributing members can re-identify an individual, so it must be
 * suppressed ("insufficient data to display") rather than shown.
 *
 * Rules (see docs/gdpr-data-access-matrix.md):
 *   • Count DISTINCT members behind a figure, never sessions. One member with
 *     50 sessions is still k=1 → suppress.
 *   • Applies ONLY to member-derived usage aggregates. NEVER suppress seat
 *     count, plan, status, renewal date, or commission — those always render
 *     regardless of group size.
 *   • Threshold is per-context so partner-facing surfaces can be tightened
 *     independently of internal admin/department surfaces later.
 */

/** Contexts that carry their own threshold. Add here, not inline. */
export type KAnonContext = "partnerEnterprise" | "department" | "periodSlice";

/**
 * Per-context minimum distinct-member count.
 *
 * `department` + `periodSlice` are 0 (suppression OFF) per product decision
 * 2026-06-04: the enterprise / department admins are the org's own data
 * controllers, so their Usage panels show full aggregates even for tiny
 * groups. `partnerEnterprise` keeps k=5 — Channel Partners are a third
 * party and their exposure stays minimized.
 */
export const K_ANON_THRESHOLD: Record<KAnonContext, number> = {
  partnerEnterprise: 5,
  department: 0,
  periodSlice: 0,
};

export const SUPPRESSED_LABEL = "Insufficient data to display";

/** True when a figure backed by `memberCount` distinct members must be hidden. */
export function isSuppressed(memberCount: number, context: KAnonContext): boolean {
  return memberCount < K_ANON_THRESHOLD[context];
}

/**
 * Wrap a member-derived value. When the contributing distinct-member count is
 * below the context threshold, `value` is null and `suppressed` is true — the
 * caller renders SUPPRESSED_LABEL. Otherwise the value passes through.
 *
 * Use for: per-department usage shown to admin/partner, per-enterprise usage
 * shown to a partner, per-period usage slices. Do NOT use for seat/plan/
 * status/commission.
 */
export interface MaybeSuppressed<T> {
  suppressed: boolean;
  memberCount: number;
  value: T | null;
}

export function suppressValue<T>(
  value: T,
  memberCount: number,
  context: KAnonContext,
): MaybeSuppressed<T> {
  if (isSuppressed(memberCount, context)) {
    return { suppressed: true, memberCount, value: null };
  }
  return { suppressed: false, memberCount, value };
}

/**
 * Suppress rows in a list of aggregates. Each row must expose its distinct
 * contributing-member count via `getMemberCount`. Suppressed rows keep their
 * identity/non-usage fields (via `keep`) but have usage nulled.
 *
 * Returns a new array; never mutates input.
 */
export function suppressRows<Row, Kept>(
  rows: readonly Row[],
  context: KAnonContext,
  getMemberCount: (row: Row) => number,
  keep: (row: Row) => Kept,
): Array<Kept & { suppressed: boolean; memberCount: number }> {
  return rows.map((row) => {
    const memberCount = getMemberCount(row);
    return {
      ...keep(row),
      suppressed: isSuppressed(memberCount, context),
      memberCount,
    };
  });
}
