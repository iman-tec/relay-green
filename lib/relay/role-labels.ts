/*
 * Human-readable labels and post-sign-in routing for roles.
 *
 * DB stores role identifiers via the public.roles lookup table. The full
 * list of identifiers lives in lib/relay/roles.ts as typed constants —
 * import ROLE / Role from there instead of writing string literals.
 */

import { ROLE, type Role } from "./roles";

const LABELS: Record<Role, string> = {
  [ROLE.super_admin]:      "Super Admin",
  [ROLE.reseller]:         "Reseller",
  [ROLE.enterprise_admin]: "Enterprise Admin",
  [ROLE.department_admin]: "Department Admin",
  [ROLE.supervisor]:       "Supervisor",
  [ROLE.engineer]:         "Engineer",
  [ROLE.client]:           "Client",
};

/** Human label for a role identifier. Unknown tokens fall back to a
 *  Title-Cased version so they never render raw. */
export function formatRole(role: string | null | undefined): string {
  if (!role) return "—";
  return (LABELS as Record<string, string>)[role] ?? titleCase(role);
}

/**
 * Highest-privilege label for the staff sidebar profile chip. First
 * match in privilege order wins (matches roles.rank descending).
 */
export function highestRoleLabel(roles: readonly string[]): string {
  if (roles.includes(ROLE.super_admin))      return "Super Admin";
  if (roles.includes(ROLE.reseller))         return "Reseller";
  if (roles.includes(ROLE.enterprise_admin)) return "Enterprise Admin";
  if (roles.includes(ROLE.department_admin)) return "Department Admin";
  if (roles.includes(ROLE.supervisor))       return "Supervisor";
  if (roles.includes(ROLE.engineer))         return "Engineer";
  if (roles.includes(ROLE.client))           return "Client";
  return "Staff";
}

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
 * Post-sign-in landing route. First match (in privilege order) wins.
 * Shared between the OTP verifier and login-page guards so we don't
 * drift on where each role lives.
 *
 * NOTE: /reseller and /enterprise/departments are the assumed homes
 * for the two new roles. If those routes don't exist yet, point them
 * somewhere safe (/dashboard) until the dedicated surfaces ship.
 */
export function landingForRoles(roles: readonly string[]): string {
  // super_admin / enterprise_admin / department_admin now land on their
  // v2 panels. Legacy /admin/users, /enterprise, /department still work
  // for direct navigation until those surfaces are retired.
  if (roles.includes(ROLE.super_admin))      return "/admin/v2";
  if (roles.includes(ROLE.reseller))         return "/reseller";
  if (roles.includes(ROLE.enterprise_admin)) return "/enterprise/v2";
  if (roles.includes(ROLE.department_admin)) return "/department/v2";
  if (roles.includes(ROLE.supervisor))       return "/supervise";
  if (roles.includes(ROLE.engineer))         return "/dashboard";
  return "/room";
}
