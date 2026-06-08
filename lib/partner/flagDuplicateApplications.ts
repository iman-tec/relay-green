/*
 * Duplicate flagging for the partner-application queue.
 *
 * A row is a duplicate when an EARLIER (older) row shares its work email or
 * company name. Reviewer-facing signal only — never blocks or merges a row
 * (brief: flag, don't dedupe). Pure function so the queue API and the tests
 * exercise identical logic.
 *
 * Input order is irrelevant: we sort a shallow copy by createdAt ascending,
 * walk oldest→newest marking later collisions, and return a Set of duplicate
 * ids.
 */

export type DuplicatableApplication = {
  id: string;
  workEmail: string;
  companyName: string;
  createdAt: string;
};

export function flagDuplicateApplications(
  rows: readonly DuplicatableApplication[]
): Set<string> {
  const ordered = [...rows].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  const seenEmail = new Set<string>();
  const seenCompany = new Set<string>();
  const dup = new Set<string>();
  for (const r of ordered) {
    const email = r.workEmail.trim().toLowerCase();
    const company = r.companyName.trim().toLowerCase();
    if (seenEmail.has(email) || seenCompany.has(company)) dup.add(r.id);
    seenEmail.add(email);
    seenCompany.add(company);
  }
  return dup;
}
