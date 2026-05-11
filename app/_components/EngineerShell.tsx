"use client";

/*
 * Engineer-side shell (Dashboard / Inbox / Triage / Settings).
 *
 * Top nav: Relay. wordmark + tabs + actions (Triage pill, bell, profile).
 * Active tab is detected from the current pathname.
 */

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "./Wordmark";
import { Bell, PhoneIncoming, Loader2 } from "lucide-react";
import { useStaffGuard } from "@/lib/relay/useStaffGuard";
import { EngineerIncomingRequest } from "./EngineerIncomingRequest";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

type Tab = { href: string; label: string; roles: string[] };

// Each tab lists the roles allowed to see it. Supervisors only get
// Triage + Supervise + Settings — never the engineer-side call inbox.
const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["engineer"] },
  { href: "/inbox",     label: "Inbox",     roles: ["engineer"] },
  { href: "/triage",    label: "Triage",    roles: ["engineer", "pod_lead", "ops_manager", "admin"] },
  { href: "/supervise", label: "Supervise", roles: ["pod_lead", "ops_manager", "admin"] },
  { href: "/settings",  label: "Settings",  roles: ["engineer", "pod_lead", "ops_manager", "admin"] },
];

// Routes that must be locked away from supervisors entirely (they get
// silently redirected to /supervise if they hit one).
const ENGINEER_ONLY_PATHS = ["/dashboard", "/inbox", "/staff/session"];

function isEngineer(roles: string[]): boolean {
  return roles.includes("engineer");
}

export function EngineerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const guard = useStaffGuard();

  // Supervisors / admins land on engineer-only paths (e.g. someone shared a
  // /staff/session/<id> link) — silently redirect to their home.
  const roles = guard.kind === "staff" ? guard.roles : [];
  const engineer = isEngineer(roles);
  const inEngineerOnlyArea = ENGINEER_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  useEffect(() => {
    if (guard.kind === "staff" && !engineer && inEngineerOnlyArea) {
      router.replace("/supervise");
    }
  }, [guard.kind, engineer, inEngineerOnlyArea, router]);

  if (guard.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }
  if (guard.kind === "anonymous") {
    return null; // window.location redirect already in flight
  }
  if (guard.kind === "not-staff") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ backgroundColor: "var(--background)" }}>
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
            Staff access required
          </h2>
          <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Your account doesn&apos;t have engineer / supervisor / admin role yet.
            Pick a role on the staff sign-in page (dev).
          </p>
          <div className="flex justify-center gap-2">
            <Link
              href="/staff/login"
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              Pick role
            </Link>
            <Link
              href="/room"
              className="rounded-md border px-4 py-2 text-sm"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Customer view
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--background)" }}>
      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "color-mix(in srgb, var(--surface) 88%, transparent)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between gap-4 px-6">
          {/* Left: wordmark + tabs */}
          <div className="flex items-center gap-6">
            <Link href={engineer ? "/dashboard" : "/supervise"} className="no-underline">
              <Wordmark size="md" />
            </Link>
            <nav className="flex items-center gap-1">
              {TABS.filter((t) => t.roles.some((r) => roles.includes(r))).map((t) => {
                const active = pathname === t.href || pathname.startsWith(t.href + "/");
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
                    style={{
                      fontWeight: active ? 600 : 500,
                      color: active ? "var(--text)" : "var(--text-muted)",
                      backgroundColor: active ? BRAND_GREEN_SOFT : "transparent",
                    }}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            <Link
              href="/triage"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            >
              <PhoneIncoming size={13} />
              Triage
            </Link>
            <button
              className="relative rounded-md p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              aria-label="Notifications"
            >
              <Bell size={16} style={{ color: "var(--text-muted)" }} />
              <span
                className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[8px] font-bold"
                style={{ backgroundColor: "#d97757", color: "#fff" }}
              >
                9+
              </span>
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
              style={{ backgroundColor: "var(--text)", color: "var(--surface)" }}
              aria-label="Profile"
            >
              EE
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* Incoming-request push notification is engineers-only — supervisors
          and admins handle triage/oversight, not direct calls. */}
      {engineer && <EngineerIncomingRequest />}
    </div>
  );
}
