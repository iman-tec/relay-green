/*
 * Login surface — which sign-in page each role is allowed to use.
 *
 * The app exposes FOUR distinct login routes, each with role-gated entry.
 * A user whose role isn't allowed on a surface gets signed out and bounced
 * to their correct surface with a notice. Invitation emails generate the
 * URL that matches the invitee's role, so recipients never land on the
 * wrong surface.
 *
 *   /login      → client (individual customer)
 *   /staff      → super_admin, supervisor, engineer  (platform staff)
 *   /partner    → reseller                            (channel partner)
 *   /business   → enterprise_admin, department_admin, client (dept member)
 *
 * The overlap on `client` (both /login and /business accept it) is
 * intentional: an individual customer signs up via /login; a department
 * employee invited by their company gets /business in their invite email.
 * Same DB role, different invite path. Server-side gates accept the role
 * on either surface, the invite link decides.
 */

import { ROLE, type Role } from "./roles";

export type LoginSurface = "customer" | "staff" | "partner" | "business";

/** Which roles are accepted on each surface. */
export const SURFACE_ROLES: Record<LoginSurface, readonly Role[]> = {
  customer: [ROLE.client],
  staff:    [ROLE.super_admin, ROLE.supervisor, ROLE.engineer],
  partner:  [ROLE.reseller],
  business: [ROLE.enterprise_admin, ROLE.department_admin, ROLE.client],
} as const;

/** Public URL of each surface. Used by proxy redirects + invite emails. */
export const SURFACE_URL: Record<LoginSurface, string> = {
  customer: "/login",
  staff:    "/staff",
  partner:  "/partner",
  business: "/business",
} as const;

/** Human label for each surface, used in error messages. */
export const SURFACE_LABEL: Record<LoginSurface, string> = {
  customer: "Customer sign-in",
  staff:    "Staff sign-in",
  partner:  "Channel Partner sign-in",
  business: "Enterprise sign-in",
} as const;

/** Does any of `roles` permit entry on `surface`?
 *
 * Special case: a user with NO roles assigned is treated as a default
 * customer — they fall through to /login → /room (which is what the
 * pre-refactor behaviour did via `landingForRoles([])`). Without this,
 * any user whose row hasn't been linked to a role yet gets locked out
 * of EVERY surface. Privilege never escalates: empty roles only opens
 * the customer surface, not staff / partner / business.
 */
export function isAllowedOnSurface(
  roles: readonly string[],
  surface: LoginSurface,
): boolean {
  if (roles.length === 0) return surface === "customer";
  const allowed: readonly string[] = SURFACE_ROLES[surface];
  return roles.some((r) => allowed.includes(r));
}

/**
 * The canonical surface for a set of roles, using the same precedence as
 * landingForRoles(): a user with multiple roles is sent to the highest-
 * privilege surface they're allowed on. Used to redirect a user who lands
 * on the wrong login URL ("you're a Supervisor — sign in here instead").
 */
export function preferredSurfaceForRoles(roles: readonly string[]): LoginSurface {
  if (roles.includes(ROLE.super_admin))      return "staff";
  if (roles.includes(ROLE.supervisor))       return "staff";
  if (roles.includes(ROLE.engineer))         return "staff";
  if (roles.includes(ROLE.reseller))         return "partner";
  if (roles.includes(ROLE.enterprise_admin)) return "business";
  if (roles.includes(ROLE.department_admin)) return "business";
  // Plain `client` — default to the public customer surface. Department
  // members can override this by following the /business invite link
  // they received from their admin.
  return "customer";
}

/**
 * URL to bounce a user to when they hit a login surface they're NOT
 * allowed on. Includes a query param so the destination page can render
 * a notice ("wrong surface — try here").
 */
export function redirectForWrongSurface(roles: readonly string[]): string {
  const target = preferredSurfaceForRoles(roles);
  return `${SURFACE_URL[target]}?wrong_surface=1`;
}

/** The login URL for a role being invited (used by invite email builder). */
export function loginUrlForInvitedRole(role: string | null | undefined): string {
  if (!role) return SURFACE_URL.customer;
  // An invited department employee (role=client invited via /business by
  // their admin) gets /business so they land on the right surface; this
  // assumes the invite scope is one of department/company/partner.
  if (role === ROLE.client)           return SURFACE_URL.business;
  if (role === ROLE.reseller)         return SURFACE_URL.partner;
  if (role === ROLE.enterprise_admin) return SURFACE_URL.business;
  if (role === ROLE.department_admin) return SURFACE_URL.business;
  if (role === ROLE.super_admin)      return SURFACE_URL.staff;
  if (role === ROLE.supervisor)       return SURFACE_URL.staff;
  if (role === ROLE.engineer)         return SURFACE_URL.staff;
  return SURFACE_URL.customer;
}
