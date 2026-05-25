"use client";

/*
 * Floating theme toggle — fixed-position sun/moon button rendered on
 * pages that don't have a persistent chrome (no sidebar, no admin tab
 * header). Customer routes (`/`, `/room`, `/intake`, `/login`,
 * `/set-password`, marketing) are the main use-case.
 *
 * Hidden on staff surfaces (`/dashboard`, `/supervise`, `/admin`,
 * `/enterprise`, `/department`, `/operations`, `/finance`, `/reseller`,
 * `/staff/*`) — those already mount a ThemeToggle in the sidebar or
 * panel header.
 */

import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const STAFF_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/triage",
  "/supervise",
  "/admin",
  "/enterprise",
  "/department",
  "/finance",
  "/operations",
  "/reseller",
  "/settings",
  "/staff",
  // /room has its own 3-theme triplet next to the wordmark — the
  // floating pill would be a duplicate control there.
  "/room",
];

// Marketing/landing surface (cream `.mk-root` theme, fixed light — it doesn't
// respond to the app's dark/light tokens), so the floating toggle would be a
// dead control there. The post-login customer app (/room, /account, /intake,
// /login, /set-password) still uses the app tokens and keeps the toggle.
const MARKETING_PREFIXES = [
  "/pricing",
  "/product",
  "/company",
  "/trust",
  "/legal",
  "/for",
  "/for-enterprise",
  "/explainer",
  "/brand-guidelines",
  "/resources",
  "/sitemap-and-content-plan",
  "/download-relay-desktop",
  "/download",
  "/payment",
];

function isStaffRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return STAFF_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function isMarketingRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/") return true; // landing/home
  return MARKETING_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function FloatingThemeToggle() {
  const pathname = usePathname();
  if (isStaffRoute(pathname) || isMarketingRoute(pathname)) return null;

  return (
    <div
      // Fixed bottom-right with safe-area padding so it sits above any
      // mobile gesture bar without overlapping the customer composer.
      className="fixed bottom-4 right-4 z-40 print:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0)",
        paddingRight:  "env(safe-area-inset-right, 0)",
      }}
    >
      <div
        className="rounded-full border shadow-sm backdrop-blur"
        style={{
          borderColor:     "var(--border)",
          backgroundColor: "color-mix(in srgb, var(--surface) 92%, transparent)",
        }}
      >
        <ThemeToggle className="rounded-full !border-0 !px-2.5" />
      </div>
    </div>
  );
}
