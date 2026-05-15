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

/**
 * Hierarchy used by the staff sidebar profile chip:
 *
 *   super_admin
 *   └─ enterprise_admin
 *      └─ admin
 *         └─ supervisor   (pod_lead, ops_manager collapsed into one tier)
 *            └─ engineer
 *               └─ customer / builder
 *
 * This is intentionally distinct from `formatRole()` — that one names the
 * specific underlying role for role-assignment UIs. The hierarchy display
 * collapses pod_lead + ops_manager into "Supervisor" so a viewer reading
 * the chip sees their *level*, not which specific supervisory flavor they
 * hold. Changing the labels here does NOT change the role-picker dropdowns
 * in /admin/users.
 */
export function highestRoleLabel(roles: readonly string[]): string {
  if (roles.includes("super_admin"))      return "Super Admin";
  if (roles.includes("enterprise_admin")) return "Enterprise Admin";
  if (roles.includes("admin"))            return "Admin";
  if (roles.includes("ops_manager"))      return "Supervisor";
  if (roles.includes("pod_lead"))         return "Supervisor";
  if (roles.includes("engineer"))         return "Engineer";
  if (roles.includes("builder"))          return "Customer";
  if (roles.includes("customer"))         return "Customer";
  return "Staff";
}

/**
 * Same as highestRoleLabel, but appends a "+N" suffix when the user holds
 * more than one role so the chip hints that there's more behind the top
 * label. The full role list belongs on a tooltip — see the caller.
 */
export function highestRoleSummary(roles: readonly string[]): string {
  const top = highestRoleLabel(roles);
  if (roles.length <= 1) return top;
  return `${top} +${roles.length - 1}`;
}

function titleCase(s: string): string {
  return s
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Maps a user's role set to the page they should land on after sign-in
 * (and the page already-authed users should be bounced to if they revisit
 * /login or /staff/login). Order is significant — first match wins.
 *
 * Shared between the OTP verifier and the login page guards so we don't
 * drift on where each role lives.
 */
export function landingForRoles(roles: readonly string[]): string {
  if (roles.includes("super_admin"))      return "/admin";
  if (roles.includes("enterprise_admin")) return "/enterprise";
  if (roles.includes("admin"))            return "/admin";
  if (roles.includes("ops_manager"))      return "/admin";
  if (roles.includes("pod_lead"))         return "/supervise";
  if (roles.includes("engineer"))         return "/dashboard";
  return "/room";
}
