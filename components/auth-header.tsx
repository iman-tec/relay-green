/*
 * Shared header rendered inside every authenticated role dashboard.
 *
 * Includes the green-dot brand mark, the persona's name + role badge, and
 * a sign-out button (server action). Kept minimal during Phase 0; will be
 * superseded by per-role chrome (left rail, etc.) in Phase 1.
 */

import { signOut } from "@/app/login/actions";
import { brand } from "@/lib/brand";
import type { SessionUser } from "@/lib/auth";

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  CUSTOMER: "Customer",
  ENGINEER: "Engineer",
  SUPERVISOR: "Supervisor",
  ENTERPRISE_ADMIN: "Enterprise admin",
  INTERNAL_ADMIN: "Internal admin",
};

export function AuthHeader({ user }: { user: SessionUser }) {
  return (
    <header
      className="flex items-center justify-between border-b px-6 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: "var(--green-dot)" }}
          aria-hidden="true"
        />
        <span className="text-sm font-medium">{brand.name}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user.displayName}</span>
        <span
          className="rounded-full border px-2 py-0.5 text-xs"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-muted)",
          }}
        >
          {ROLE_LABEL[user.role]}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="text-xs underline"
            style={{ color: "var(--text-muted)" }}
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
