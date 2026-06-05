/*
 * Single source of truth for role identifiers in the application.
 *
 * DB-side, the canonical list lives in public.roles (lookup table) and
 * user_roles.role_id references it. This file mirrors the lookup-table
 * `name` column as TypeScript constants so the rest of the app never
 * writes raw role strings like 'enterprise_admin' or 'engineer'. Any
 * new role must be added here AND seeded into public.roles via a
 * migration.
 *
 * Creation hierarchy (top → bottom):
 *   super_admin       creates  reseller  OR  enterprise + enterprise_admin
 *   reseller          creates  enterprise + enterprise_admin
 *   enterprise_admin  creates  departments + department_admins
 *   department_admin  creates  clients (employees) within their department
 *
 * Platform-side roles (supervisor, engineer) sit OUTSIDE this enterprise
 * hierarchy — they're employees of the platform who run support sessions.
 */

export const ROLE = {
  super_admin: "super_admin",
  reseller: "reseller",
  enterprise_admin: "enterprise_admin",
  department_admin: "department_admin",
  supervisor: "supervisor",
  engineer: "engineer",
  client: "client",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Every known role, in privilege-descending order (matches roles.rank). */
export const ALL_ROLES: readonly Role[] = [
  ROLE.super_admin,
  ROLE.reseller,
  ROLE.enterprise_admin,
  ROLE.department_admin,
  ROLE.supervisor,
  ROLE.engineer,
  ROLE.client,
] as const;

/**
 * Roles that get into staff-side surfaces (/dashboard, /supervise, /admin,
 * /enterprise, etc.). Clients are excluded — they go to /room.
 */
export const STAFF_ROLES: readonly Role[] = [
  ROLE.super_admin,
  ROLE.reseller,
  ROLE.enterprise_admin,
  ROLE.department_admin,
  ROLE.supervisor,
  ROLE.engineer,
] as const;

/**
 * Roles that manage other users inside the enterprise/department
 * hierarchy. Used by admin-UI guards that ask "can this user create or
 * manage members?"
 */
export const ENTERPRISE_MANAGER_ROLES: readonly Role[] = [
  ROLE.super_admin,
  ROLE.reseller,
  ROLE.enterprise_admin,
  ROLE.department_admin,
] as const;

/**
 * Platform-side roles that run actual support sessions (not the
 * enterprise hierarchy).
 */
export const PLATFORM_OPS_ROLES: readonly Role[] = [
  ROLE.supervisor,
  ROLE.engineer,
] as const;

/** Type guard. Useful when a value comes in from a DB row or JSON body. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ALL_ROLES as readonly string[]).includes(value)
  );
}

/** Filter an unknown[] down to the recognised role names. */
export function toRoles(values: readonly unknown[] | null | undefined): Role[] {
  if (!values) return [];
  return values.filter(isRole);
}
