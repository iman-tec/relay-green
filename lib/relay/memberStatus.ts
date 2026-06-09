/*
 * Member lifecycle status — the single source of truth, derived from auth
 * signals so every surface (enterprise members, department employees) agrees:
 *
 *   Suspended  — the auth user is banned.
 *   Invited    — never signed in yet (added but not accepted).
 *   Active     — has signed in at least once.
 *
 * Derived (not stored) so Invited → Active flips automatically on first login,
 * surfaced on the next poll. Suspended is separate + reversible (un-ban).
 */

export type MemberStatus = "suspended" | "active" | "invited";

export function deriveMemberStatus(
  banned: boolean,
  lastSignIn: string | null | undefined
): MemberStatus {
  if (banned) return "suspended";
  if (lastSignIn) return "active";
  return "invited";
}

/** The later of two ISO-8601 timestamps (lexicographic compare is valid for
 *  ISO-8601); null only when both are null. Used for "last activity". */
export function laterIso(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}
