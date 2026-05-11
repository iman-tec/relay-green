"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  setSessionCookie,
  clearSessionCookie,
  dashboardForRole,
} from "@/lib/auth";
import { auditLog } from "@/lib/audit";

/**
 * Demo sign-in: accepts a userId from the picker, sets the session cookie,
 * and redirects to the role's dashboard. Production auth (claude.ai-mirror
 * flow) ships in Phase 4.
 */
export async function signInAsDemoUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new Error("User not found or not active");
  }

  await setSessionCookie(user.id);
  await auditLog({
    actorUserId: user.id,
    action: "USER_LOGIN",
    entityType: "User",
    entityId: user.id,
    metadata: { method: "demo-picker" },
  });

  redirect(dashboardForRole(user.role));
}

/** Demo sign-out: clears cookie and returns to public landing. */
export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/");
}
