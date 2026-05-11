/*
 * Demo authentication (RG-0201).
 *
 * Phase 0 / Phase 1 placeholder. Replaced in Phase 4 by the full
 * claude.ai-mirror flow (passwordless email-OTP + phone-OTP + OAuth) per
 * Spec Decisions C2.
 *
 * Session is a plaintext cookie containing the userId. Read server-side via
 * `getSessionUser()`. Protect routes via `requireRole()` or the middleware.
 *
 * NEVER use this auth scheme in production.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import type { UserRole } from "@/app/generated/prisma/enums";

const SESSION_COOKIE = "relay_demo_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7; // 1 week

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string | null;
};

/** Returns the signed-in demo user, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      organizationId: true,
      status: true,
    },
  });
  if (!user || user.status !== "ACTIVE") return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    organizationId: user.organizationId,
  };
}

/**
 * Server-side role guard. Redirects to /login if not signed in, or to the
 * authenticated user's correct dashboard if they have the wrong role.
 */
export async function requireRole(
  allowed: UserRole | UserRole[]
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedList.includes(user.role)) redirect(dashboardForRole(user.role));
  return user;
}

/** Returns the dashboard route for a role. */
export function dashboardForRole(role: UserRole): string {
  switch (role) {
    case "CUSTOMER":
      return "/customer";
    case "ENGINEER":
      return "/engineer";
    case "SUPERVISOR":
      return "/supervisor";
    case "ENTERPRISE_ADMIN":
      return "/enterprise";
    case "INTERNAL_ADMIN":
      return "/admin";
  }
}

/** Sets the demo session cookie. Used by the sign-in server action. */
export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_S,
    path: "/",
  });
}

/** Clears the demo session cookie. Used by the sign-out server action. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
