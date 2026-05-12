"use client";

/*
 * Engineer/Supervisor shell — top nav for Dashboard / Inbox / Triage / Supervise.
 *
 * Profile button: real initials + dropdown (email, role, logout).
 * Notification bell: live count — queued sessions for engineers,
 *                    urgent/critical active sessions for supervisors.
 * Supervisor alerts: non-blocking toasts when urgent sessions appear
 *                    (no full-screen popup like engineers get).
 */

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "./Wordmark";
import { Bell, PhoneIncoming, Loader2, LogOut, ChevronDown, AlertTriangle, X } from "lucide-react";
import { useStaffGuard } from "@/lib/relay/useStaffGuard";
import { EngineerIncomingRequest } from "./EngineerIncomingRequest";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER     = "#c66645";
const URGENT_AMBER_SOFT= "rgba(198, 102, 69, 0.14)";
const CRIT_RED         = "#c8553d";
const CRIT_RED_SOFT    = "rgba(200, 85, 61, 0.18)";

type Tab = { href: string; label: string; roles: string[] };

const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["engineer"] },
  { href: "/inbox",     label: "Inbox",     roles: ["engineer"] },
  { href: "/triage",    label: "Triage",    roles: ["engineer", "pod_lead", "ops_manager", "admin"] },
  { href: "/supervise", label: "Supervise", roles: ["pod_lead", "ops_manager", "admin"] },
  { href: "/settings",  label: "Settings",  roles: ["engineer", "pod_lead", "ops_manager", "admin"] },
];

const ENGINEER_ONLY_PATHS = ["/dashboard", "/inbox", "/staff/session"];

function isEngineer(roles: string[]): boolean {
  return roles.includes("engineer");
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function roleLabel(roles: string[]): string {
  if (roles.includes("admin"))       return "Admin";
  if (roles.includes("ops_manager")) return "Supervisor";
  if (roles.includes("pod_lead"))    return "Pod lead";
  if (roles.includes("engineer"))    return "Engineer";
  return "Staff";
}

// ── Supervisor alert toast ─────────────────────────────────────────────────
type AlertToast = { id: string; sessionId: string; name: string; urgency: string };

function SupervisorAlerts({ roles }: { roles: string[] }) {
  const isSupervisor = !isEngineer(roles);
  const [alerts, setAlerts] = useState<AlertToast[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const supabaseRef = useRef(createClient());

  const dismiss = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  useEffect(() => {
    if (!isSupervisor) return;
    const sb = supabaseRef.current;

    const ch = sb
      .channel("supervisor-alerts")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_calls" },
        (payload) => {
          const row = payload.new as GuestCall;
          if (
            (row.urgency === "urgent" || row.urgency === "critical") &&
            ["queued", "assigned", "joining", "live", "grace"].includes(row.status) &&
            !seenRef.current.has(row.id)
          ) {
            seenRef.current.add(row.id);
            const toast: AlertToast = {
              id: crypto.randomUUID(),
              sessionId: row.id,
              name: row.guest_name ?? "A customer",
              urgency: row.urgency,
            };
            setAlerts((prev) => [...prev.slice(-4), toast]); // keep latest 5
            // Auto-dismiss after 12 s
            setTimeout(() => dismiss(toast.id), 12_000);
          }
        },
      )
      .subscribe();

    return () => { void sb.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupervisor]);

  if (!isSupervisor || alerts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {alerts.map((a) => {
        const isCrit = a.urgency === "critical";
        return (
          <div
            key={a.id}
            className="flex max-w-xs items-start gap-3 rounded-xl border p-3.5 shadow-lg"
            style={{
              backgroundColor: "var(--surface)",
              borderColor: isCrit ? CRIT_RED + "55" : URGENT_AMBER + "55",
            }}
          >
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: isCrit ? CRIT_RED_SOFT : URGENT_AMBER_SOFT, color: isCrit ? CRIT_RED : URGENT_AMBER }}
            >
              <AlertTriangle size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: isCrit ? CRIT_RED : URGENT_AMBER }}>
                {isCrit ? "Critical" : "Urgent"} session
              </p>
              <p className="truncate text-xs" style={{ color: "var(--text)" }}>
                {a.name} needs attention
              </p>
              <Link
                href={`/staff/session/${a.sessionId}`}
                className="mt-1 inline-block text-[11px] underline-offset-2 hover:underline"
                style={{ color: BRAND_GREEN }}
                onClick={() => dismiss(a.id)}
              >
                View session →
              </Link>
            </div>
            <button onClick={() => dismiss(a.id)} className="shrink-0 opacity-40 hover:opacity-80" style={{ color: "var(--text)" }}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Notification bell with live count ─────────────────────────────────────
function NotificationBell({ roles }: { roles: string[] }) {
  const [count, setCount] = useState(0);
  // Own user ID — used to exclude the engineer's own customer sessions
  // from the notification count (dev.soni as engineer shouldn't see their
  // own customer request ringing at them).
  const myUserIdRef = useRef<string | null>(null);
  const supabaseRef = useRef(createClient());
  const engineer = isEngineer(roles);

  useEffect(() => {
    supabaseRef.current.auth.getUser().then(({ data }) => {
      if (data.user?.id) myUserIdRef.current = data.user.id;
    }, () => {});
  }, []);

  const fetchCount = useCallback(async () => {
    const sb = supabaseRef.current;
    const myId = myUserIdRef.current;
    if (engineer) {
      // Engineers: count of queued sessions — excluding their own customer sessions
      let q = sb
        .from("guest_calls")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued");
      if (myId) q = q.neq("customer_user_id", myId);
      const { count: c } = await q;
      setCount(c ?? 0);
    } else {
      // Supervisors: count of urgent/critical active sessions
      let q = sb
        .from("guest_calls")
        .select("*", { count: "exact", head: true })
        .in("status", ["queued", "assigned", "joining", "live", "grace"])
        .in("urgency", ["urgent", "critical"]);
      if (myId) q = q.neq("customer_user_id", myId);
      const { count: c } = await q;
      setCount(c ?? 0);
    }
  }, [engineer]);

  useEffect(() => {
    void fetchCount();
    const sb = supabaseRef.current;
    const ch = sb
      .channel("shell-notif-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_calls" }, () => {
        void fetchCount();
      })
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [fetchCount]);

  return (
    <button
      className="relative rounded-md p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      aria-label={`Notifications${count > 0 ? ` — ${count} pending` : ""}`}
      title={engineer ? `${count} queued session${count !== 1 ? "s" : ""}` : `${count} urgent session${count !== 1 ? "s" : ""}`}
    >
      <Bell size={16} style={{ color: "var(--text-muted)" }} />
      {count > 0 && (
        <span
          className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[8px] font-bold"
          style={{ backgroundColor: count > 0 && !engineer ? URGENT_AMBER : "#d97757", color: "#fff" }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

// ── Profile button + dropdown ──────────────────────────────────────────────
function ProfileMenu({ roles }: { roles: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    supabaseRef.current.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    }, () => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabaseRef.current.auth.signOut();
    router.replace("/staff/login");
  };

  const abbrev = email ? initials(email) : "··";
  const label  = roleLabel(roles);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full transition-opacity hover:opacity-80"
        aria-label="Profile menu"
        aria-expanded={open}
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
          style={{ backgroundColor: "var(--text)", color: "var(--surface)" }}
        >
          {abbrev}
        </span>
        <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-xl border shadow-lg"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {abbrev}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                {email.split("@")[0] || "Staff"}
              </p>
              <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                {email}
              </p>
            </div>
          </div>

          {/* Role badge */}
          <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            >
              {label}
            </span>
          </div>

          {/* Sign out */}
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            {signingOut
              ? <Loader2 size={14} className="animate-spin" />
              : <LogOut size={14} />}
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────
export function EngineerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const guard    = useStaffGuard();

  const roles    = guard.kind === "staff" ? guard.roles : [];
  const engineer = isEngineer(roles);

  const inEngineerOnlyArea = ENGINEER_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

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
  if (guard.kind === "anonymous") return null;
  if (guard.kind === "not-staff") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ backgroundColor: "var(--background)" }}>
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-lg font-semibold" style={{ color: "var(--text)" }}>
            Staff access required
          </h2>
          <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Your account doesn&apos;t have an engineer / supervisor / admin role yet.
            Contact your admin or sign in with a staff account.
          </p>
          <div className="flex justify-center gap-2">
            <Link href="/staff/login" className="rounded-md px-4 py-2 text-sm font-medium" style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}>
              Staff sign in
            </Link>
            <Link href="/room" className="rounded-md border px-4 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
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
            {engineer && (
              <Link
                href="/triage"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
              >
                <PhoneIncoming size={13} />
                Triage
              </Link>
            )}
            <NotificationBell roles={roles} />
            <ProfileMenu roles={roles} />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* Engineer-only: full-screen incoming call popup */}
      {engineer && <EngineerIncomingRequest />}

      {/* Supervisor-only: non-blocking urgent session alerts */}
      {!engineer && <SupervisorAlerts roles={roles} />}
    </div>
  );
}
