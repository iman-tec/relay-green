/*
 * Single source of truth for role labels shown to humans.
 *
 * DB stores role identifiers (super_admin, ops_manager, pod_lead, etc.).
 * UI must never show those raw — always pass through formatRole().
 *
 * If you find an underscored role token leaking into the UI somewhere,
 * route it through this helper.
 */

const LABELS: Record<string, string> = {
  super_admin:  "Super Admin",
  admin:        "Enterprise Admin",
  ops_manager:  "Internal Admin",
  pod_lead:     "Supervisor",
  engineer:     "Engineer",
  builder:      "Customer",
  customer:     "Customer",
};

/** Human label for a single role string. Falls back to a Title-Cased
 *  version of the raw identifier if it's unknown. */
export function formatRole(role: string | null | undefined): string {
  if (!role) return "—";
  return LABELS[role] ?? titleCase(role);
}

/** Picks the highest-rank role from a set and returns its label. */
export function highestRoleLabel(roles: readonly string[]): string {
  const order = [
    "super_admin",
    "admin",
    "ops_manager",
    "pod_lead",
    "engineer",
    "builder",
    "customer",
  ];
  for (const r of order) {
    if (roles.includes(r)) return formatRole(r);
  }
  return "Staff";
}

function titleCase(s: string): string {
  return s
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
