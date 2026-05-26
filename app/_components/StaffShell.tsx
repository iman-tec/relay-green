"use client";

/*
 * Staff shell — left sidebar layout, collapsible, icon-first.
 *
 * Mirrors the customer-room sidebar pattern (RoomClient) so admin /
 * supervisor / engineer surfaces feel consistent with the customer view.
 *
 * - Sidebar width: 240px open, 60px collapsed. State persists in
 *   localStorage so a reload keeps your preference.
 * - Top: wordmark (full when open, dot-only when collapsed) + toggle.
 * - Middle: nav items, each rendered as icon + label. Labels hide when
 *   collapsed; the icon shows a native tooltip with the label.
 * - Bottom: profile chip with initials avatar + dropdown (email, role,
 *   logout). When collapsed, chip is just the avatar; click expands a
 *   dropdown anchored to the right of the sidebar.
 *
 * Auth-guarded by useStaffGuard. Drives the same notifications + incoming
 * call popup as the legacy EngineerShell.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Loader2, LogOut, ChevronDown, AlertTriangle, X,
  PanelLeftClose, PanelLeftOpen, LayoutDashboard,
  Eye, Users as UsersIcon, Wallet as WalletIcon, Table as TableIcon, Inbox as InboxIcon,
  Settings, ShieldCheck, FileText,
} from "lucide-react";
import { Wordmark } from "./Wordmark";
import { ThemeTriplet } from "./ThemeTriplet";
import { EngineerProfilePane } from "./EngineerProfilePane";
import { EngineerPresenceBadge } from "./EngineerPresenceBadge";
import { LegalPane, type LegalKind } from "./LegalPane";
import { useStaffGuard } from "@/lib/relay/useStaffGuard";
import { highestRoleLabel, highestRoleSummary, formatRole } from "@/lib/relay/role-labels";
import { ROLE, type Role } from "@/lib/relay/roles";
// TEMP 2026-05-18: legacy first-come-first-served ring disabled while
// the push-ring path (EngineerIncomingMatch) is validated. Re-enable the
// import + mount below to bring it back.
// import { EngineerIncomingRequest } from "./EngineerIncomingRequest";
import { EngineerIncomingMatch } from "./EngineerIncomingMatch";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN       = "#3f5c2e";
const BRAND_GREEN_SOFT  = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER      = "#d4a017";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const CRIT_RED          = "#8b1a1a";
const CRIT_RED_SOFT     = "rgba(139, 26, 26, 0.18)";

const SIDEBAR_OPEN_W = 240;
const SIDEBAR_CLOSED_W = 60;
const COLLAPSED_KEY = "relay.staff.sidebar.collapsed";

type Nav = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  roles: Role[];
};

// /triage and /settings deliberately omitted from the sidebar.
// /triage was redundant once /dashboard grew Take-next + queue.
// /settings will return when account-settings land.
const NAV: Nav[] = [
  { href: "/dashboard",            label: "Dashboard", icon: LayoutDashboard, roles: [ROLE.engineer] },
  // Engineer-only. People + per-customer session history + call log.
  { href: "/inbox",                label: "Inbox",     icon: InboxIcon,       roles: [ROLE.engineer] },
  // /supervise renders the platform-wide grid for super_admin + supervisor,
  // and the org-scoped grid for enterprise + department admins — see
  // app/(staff)/supervise/page.tsx.
  { href: "/supervise",            label: "Supervise", icon: Eye,             roles: [ROLE.supervisor, ROLE.department_admin, ROLE.enterprise_admin, ROLE.super_admin] },
  // super_admin's primary surface — the redesigned 4-tab panel
  // (Enterprise / Reseller / Pods / Internal Users).
  { href: "/admin/v2",             label: "Users",     icon: UsersIcon,       roles: [ROLE.super_admin] },
  // enterprise_admin's primary surface — the redesigned Departments panel.
  { href: "/enterprise/v2",        label: "Dashboard", icon: LayoutDashboard, roles: [ROLE.enterprise_admin] },
  // reseller-owner console — redesigned v2 panel (from rutul-working).
  { href: "/reseller/v2",          label: "Channel Partner", icon: LayoutDashboard, roles: [ROLE.reseller] },
  // department_admin's primary surface — the redesigned Employees panel.
  { href: "/department/v2",        label: "Department", icon: LayoutDashboard, roles: [ROLE.department_admin] },
  // /finance is the org-level money + feedback console — enterprise_admin
  // only. Department admins don't see it; their finance scope is the
  // dept-only view at /department.
  { href: "/finance",              label: "Finance",   icon: WalletIcon,      roles: [ROLE.enterprise_admin] },
  // /operations is the supervisor's pod roster — engineers under them with
  // current customer + last call.
  { href: "/operations",           label: "Operations", icon: TableIcon,       roles: [ROLE.supervisor] },
];

const ENGINEER_ONLY_PATHS = ["/dashboard", "/inbox", "/staff/session"];

function isEngineer(roles: readonly Role[]): boolean {
  return roles.includes(ROLE.engineer);
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const guard    = useStaffGuard();
  const roles    = guard.kind === "staff" ? guard.roles : [];
  const engineer = isEngineer(roles);
  const isEnterpriseAdmin = roles.includes(ROLE.enterprise_admin) && !roles.includes(ROLE.super_admin);
  const homeHref = isEnterpriseAdmin ? "/enterprise" : engineer ? "/dashboard" : "/supervise";

  const [collapsed, setCollapsed] = useState(false);

  // In-pane overlays — Profile & settings (engineer-only) and the Privacy/
  // Terms viewer. When open, the corresponding pane renders IN PLACE OF
  // the route's <main> children so the customer's mental model of "pane
  // takes over the centre, sidebar stays put" carries over to staff.
  const [profilePaneOpen, setProfilePaneOpen] = useState(false);
  const [legalKind, setLegalKind] = useState<LegalKind | null>(null);
  const closeAllPanes = useCallback(() => {
    setProfilePaneOpen(false);
    setLegalKind(null);
  }, []);

  // Auth row pulled once at the shell level so both the user-menu trigger
  // and the EngineerProfilePane can share it without duplicate getUser()
  // round-trips. Empty string until the first fetch settles.
  const [meEmail, setMeEmail] = useState<string>("");
  useEffect(() => {
    if (guard.kind !== "staff") return;
    if (meEmail) return;
    let cancelled = false;
    void (async () => {
      const sb = (await import("@/lib/supabase/browser")).createClient();
      const { data } = await sb.auth.getUser();
      if (!cancelled && data.user?.email) setMeEmail(data.user.email);
    })();
    return () => { cancelled = true; };
  }, [guard.kind, meEmail]);

  // Restore sidebar state from localStorage on mount.
  useEffect(() => {
    try {
      const v = localStorage.getItem(COLLAPSED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "1") setCollapsed(true);
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  // Redirect engineer-only pages if a non-engineer somehow lands there
  // (e.g. an admin clicks a stale link). Mirrors the legacy guard.
  const inEngineerOnlyArea = ENGINEER_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  useEffect(() => {
    if (guard.kind === "staff" && !engineer && inEngineerOnlyArea) {
      router.replace("/supervise");
    }
  }, [guard.kind, engineer, inEngineerOnlyArea, router]);

  // Auto-open the Profile pane when the user lands on /settings (preserves
  // deep-link entry into Profile & settings). Must sit ABOVE the early
  // returns so the hook count is stable across loading/anonymous/staff
  // renders — React enforces same-order hooks every render.
  useEffect(() => {
    if (pathname === "/settings" && engineer && !profilePaneOpen) {
      setProfilePaneOpen(true);
    }
  }, [pathname, engineer, profilePaneOpen]);

  if (guard.kind === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "var(--background)" }}
      >
        <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }
  if (guard.kind === "anonymous") return null;
  if (guard.kind === "not-staff") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ backgroundColor: "var(--background)" }}
      >
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
            Staff access required
          </h2>
          <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Your account doesn&apos;t have an engineer / supervisor / admin role yet.
            Contact your admin or sign in with a staff account.
          </p>
          <div className="flex justify-center gap-2">
            <Link
              href="/staff/login"
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              Staff sign in
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

  // Bare mode — render children full-viewport with no shell chrome.
  // Used by the v2 panels where each panel owns its own navigation
  // (tab header). The guard still runs above, so auth + role
  // enforcement stays intact.
  const isBare =
    pathname === "/admin/v2"      || pathname.startsWith("/admin/v2/")      ||
    pathname === "/enterprise/v2" || pathname.startsWith("/enterprise/v2/") ||
    pathname === "/department/v2" || pathname.startsWith("/department/v2/") ||
    pathname === "/reseller/v2"   || pathname.startsWith("/reseller/v2/");
  if (isBare) {
    return (
      <div
        className="min-h-screen"
        style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
      >
        {children}
        {/* The v2 panels strip the shell chrome but must still surface the
            incoming-call ring (engineers) and supervisor alerts — including the
            "assignment declined, reassign" toast — so a super_admin sitting on
            /admin/v2 is notified just like on /supervise. */}
        {isEngineer(roles) && <EngineerIncomingMatch />}
        {!engineer && <SupervisorAlerts roles={roles} />}
      </div>
    );
  }

  // Enterprise admins should only see their two-tab console:
  //   /enterprise  (dashboard)
  //   /supervise   (org-scoped view, branches server-side on role)
  // Without this filter, an enterprise_admin who also happens to hold
  // platform-side roles for testing would see /admin/users in the sidebar.
  const ENT_ADMIN_ALLOW = new Set(["/enterprise/v2", "/enterprise", "/enterprise/departments"]);
  // Routes that super_admin should never see even when they hold the
  // underlying role for testing (e.g. dev.soni also has supervisor so she
  // can join real sessions, but /operations is a supervisor surface).
  const SUPER_ADMIN_HIDDEN = new Set(["/operations"]);
  const isSuperAdmin = roles.includes(ROLE.super_admin);
  const navItems = NAV
    .filter((n) => n.roles.some((r) => roles.includes(r)))
    .filter((n) => !isEnterpriseAdmin || ENT_ADMIN_ALLOW.has(n.href))
    .filter((n) => !isSuperAdmin || !SUPER_ADMIN_HIDDEN.has(n.href));

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <aside
        className="sticky top-0 flex h-screen shrink-0 flex-col border-r transition-[width] duration-200 ease-out"
        style={{
          width: collapsed ? SIDEBAR_CLOSED_W : SIDEBAR_OPEN_W,
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        {/* Top: wordmark + toggle */}
        <div
          className="flex items-center justify-between border-b px-3 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <Link
            href={homeHref}
            className="flex items-center no-underline"
            aria-label="Home"
          >
            {collapsed ? <DotOnly /> : <Wordmark size="md" />}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={toggle}
              className="rounded-md p-1.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              aria-label="Collapse sidebar"
              style={{ color: "var(--text-muted)" }}
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        {/* Collapsed-mode toggle (separate row so it's reachable) */}
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="mx-2 mt-2 rounded-md p-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            aria-label="Expand sidebar"
            style={{ color: "var(--text-muted)" }}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors"
                style={{
                  fontWeight: active ? 600 : 500,
                  color: active ? BRAND_GREEN : "var(--text)",
                  backgroundColor: active ? BRAND_GREEN_SOFT : "transparent",
                  justifyContent: collapsed ? "center" : "flex-start",
                }}
              >
                <Icon size={16} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}

          {/* Spacer pushes alerts + profile to bottom */}
          <div className="flex-1" />
        </nav>

        {/* Bottom: theme toggle + profile */}
        <div
          className="border-t px-2 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className={`mb-1 flex ${collapsed ? "justify-center" : "justify-end"}`}
          >
            <ThemeTriplet />
          </div>
          <ProfileButton
            email={meEmail}
            onEmailResolved={setMeEmail}
            roles={roles}
            collapsed={collapsed}
            engineer={engineer}
            onOpenProfile={() => {
              closeAllPanes();
              setProfilePaneOpen(true);
            }}
            onOpenLegal={(kind) => {
              closeAllPanes();
              setLegalKind(kind);
            }}
          />
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {profilePaneOpen && engineer && guard.kind === "staff" ? (
          <EngineerProfilePane
            userId={guard.userId}
            email={meEmail}
            onClose={() => {
              setProfilePaneOpen(false);
              // If we landed via /settings, send the user home so the URL
              // and the pane state stop disagreeing.
              if (pathname === "/settings") router.push("/dashboard");
            }}
          />
        ) : legalKind ? (
          <LegalPane kind={legalKind} onClose={() => setLegalKind(null)} />
        ) : (
          children
        )}
      </main>

      {/* Always-visible presence pill for engineers. Realtime-subscribed
          so cross-tab + deep-pane changes mirror here. Other staff
          roles don't render this (no engineer_profiles row to read). */}
      {engineer && guard.kind === "staff" && (
        <EngineerPresenceBadge userId={guard.userId} />
      )}

      {/* Full-screen incoming-call popup for anyone who can take calls
       *  (engineer role). The modal self-gates: it only renders when
       *  match_engineer has created a PENDING offer for this exact user, and
       *  the matcher only offers to engineers whose availability toggle is on
       *  (engineer_profiles.is_available). So a supervisor/admin who also
       *  holds engineer is only paged if they've gone "Online" as an engineer
       *  — availability is the control, not role composition. (Previously
       *  gated to engineer-ONLY accounts, which silently suppressed rings for
       *  multi-role engineers.)
       *
       *  TEMP 2026-05-18: legacy EngineerIncomingRequest mount disabled while
       *  the push-ring (EngineerIncomingMatch) path is validated. */}
      {/* {isEngineer(roles) && <EngineerIncomingRequest />} */}
      {isEngineer(roles) && <EngineerIncomingMatch />}

      {/* Supervisor-only: non-blocking urgent session alerts */}
      {!engineer && <SupervisorAlerts roles={roles} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function DotOnly() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        backgroundColor: BRAND_GREEN,
      }}
    />
  );
}

function ProfileButton({
  email,
  onEmailResolved,
  roles,
  collapsed,
  engineer,
  onOpenProfile,
  onOpenLegal,
}: {
  email: string;
  onEmailResolved: (email: string) => void;
  roles: string[];
  collapsed: boolean;
  engineer: boolean;
  onOpenProfile: () => void;
  onOpenLegal: (kind: LegalKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (email) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabaseRef.current.auth.getUser();
      if (!cancelled && data.user?.email) {
        onEmailResolved(data.user.email);
      }
    })();
    return () => { cancelled = true; };
  }, [email, onEmailResolved]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleSignOut = async () => {
    // Flip the engineer Offline before the session dies, so the matcher and
    // the supervisor/admin assign list stop showing them as available. Must
    // run BEFORE signOut (the RPC needs auth.uid()). Best-effort: non-engineer
    // roles get NOT_AN_ENGINEER, which we ignore.
    try {
      await supabaseRef.current.rpc("engineer_set_online", { _online: false });
    } catch { /* best-effort cleanup */ }
    // Supervisors go off duty on logout too, so coverage re-routes to whoever
    // is still on duty (non-supervisors get NOT_A_SUPERVISOR, which we ignore).
    try {
      await supabaseRef.current.rpc("supervisor_set_online", { _online: false });
    } catch { /* best-effort cleanup */ }
    await supabaseRef.current.auth.signOut();
    router.push("/staff/login");
  };

  const userEmail = email;
  const userInitials = initials(userEmail || "??");
  // Chip shows the *top* role per the hierarchy with a "+N" hint when the
  // user holds more than one. The full list lives on the hover tooltip
  // (and inside the dropdown) so the chip stays compact.
  const roleText = highestRoleSummary(roles);
  const allRolesLabel = roles.length > 0
    ? roles.map((r) => formatRole(r)).join(" · ")
    : highestRoleLabel(roles);

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        style={{ justifyContent: collapsed ? "center" : "flex-start" }}
        aria-label="Account menu"
        title={collapsed
          ? `${userEmail}\n${allRolesLabel}`
          : roles.length > 1 ? allRolesLabel : undefined}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          {userInitials}
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {userEmail || "—"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {roleText}
            </div>
          </div>
        )}
        {!collapsed && (
          <ChevronDown
            size={14}
            style={{
              color: "var(--text-muted)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 120ms ease",
            }}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute z-50 rounded-md border py-1 shadow-md"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            // Anchor: in collapsed mode → expand to the right; otherwise → up
            bottom: "100%",
            left: collapsed ? "100%" : 0,
            right: collapsed ? "auto" : 0,
            marginBottom: collapsed ? 0 : 8,
            marginLeft:   collapsed ? 8 : 0,
            minWidth: 200,
          }}
        >
          <div
            className="px-3 py-2"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {userEmail || "—"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {roles.length > 1 ? allRolesLabel : roleText}
            </div>
          </div>
          {engineer && (
            <button
              type="button"
              onClick={() => { setOpen(false); onOpenProfile(); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ color: "var(--text)" }}
            >
              <Settings size={14} />
              Profile &amp; settings
            </button>
          )}
          {roles.includes("enterprise_admin") && (
            <Link
              href="/enterprise/wallet"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm no-underline transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ color: "var(--text)" }}
            >
              <WalletIcon size={14} />
              Wallet
            </Link>
          )}
          {/* Learn more section — Privacy + Terms open in-pane (no new tab),
             same pattern the customer side uses to keep legal docs scrollable
             alongside the shell. */}
          <div
            className="border-t px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
          >
            Learn more
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); onOpenLegal("privacy"); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{ color: "var(--text)" }}
          >
            <ShieldCheck size={14} />
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onOpenLegal("terms"); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{ color: "var(--text)" }}
          >
            <FileText size={14} />
            Terms of Use
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            style={{ color: "var(--text)", borderColor: "var(--border)" }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ──────── Supervisor toast alerts (same logic as legacy shell) ──────── */

type AlertToast = { id: string; sessionId: string; name: string; urgency: string };

function SupervisorAlerts({ roles }: { roles: readonly Role[] }) {
  const isSupervisor = !isEngineer(roles);
  const [alerts, setAlerts] = useState<AlertToast[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  // Separate dedupe set for "reassignment needed" toasts so a session can be
  // re-flagged after it's reassigned (cleared when reassign_needed goes false).
  const seenReassignRef = useRef<Set<string>>(new Set());
  const supabaseRef = useRef(createClient());

  const dismiss = (id: string) =>
    setAlerts((prev) => prev.filter((a) => a.id !== id));

  useEffect(() => {
    if (!isSupervisor) return;
    const sb = supabaseRef.current;
    const ch = sb
      .channel("supervisor-alerts-shell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        (payload) => {
          const row = (payload.new ?? payload.old) as GuestCall | null;
          if (!row || !row.id) return;

          // A directed (manual) assignment was declined → the supervisor needs
          // to reassign. Toast once per reassignment episode; clear the dedupe
          // marker when the flag goes false so a later decline re-notifies.
          if (row.reassign_needed) {
            if (!seenReassignRef.current.has(row.id)) {
              seenReassignRef.current.add(row.id);
              setAlerts((prev) => [
                ...prev,
                {
                  id: `${row.id}-reassign-${Date.now()}`,
                  sessionId: row.id,
                  name: row.guest_name ?? "A customer",
                  urgency: "reassign",
                },
              ]);
            }
          } else {
            seenReassignRef.current.delete(row.id);
          }

          const urgent = row.urgency === "urgent" || row.urgency === "critical";
          const liveish = ["queued", "assigned", "joining", "live", "grace"].includes(
            row.status as string,
          );
          if (!urgent || !liveish) return;
          if (seenRef.current.has(row.id)) return;
          seenRef.current.add(row.id);
          setAlerts((prev) => [
            ...prev,
            {
              id: `${row.id}-${Date.now()}`,
              sessionId: row.id,
              name: (row as { full_name?: string }).full_name ?? "Guest",
              urgency: row.urgency as string,
            },
          ]);
        },
      )
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [isSupervisor]);

  if (!isSupervisor || !alerts.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {alerts.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg"
          style={{
            backgroundColor:
              a.urgency === "critical" ? CRIT_RED_SOFT : URGENT_AMBER_SOFT,
            borderColor:
              a.urgency === "critical" ? CRIT_RED : URGENT_AMBER,
            color: "var(--text)",
            maxWidth: 360,
          }}
        >
          <AlertTriangle
            size={16}
            style={{
              color: a.urgency === "critical" ? CRIT_RED : URGENT_AMBER,
              marginTop: 2,
            }}
          />
          <div className="flex-1">
            <div className="text-sm font-medium">
              {a.urgency === "reassign" ? "Assignment declined" : a.name}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {a.urgency === "reassign"
                ? `${a.name} needs a new engineer — reassign in Supervise`
                : `${a.urgency} session`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            className="rounded-md p-1"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
