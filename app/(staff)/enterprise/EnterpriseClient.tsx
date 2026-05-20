"use client";

/*
 * Enterprise console — landing page for enterprise_admin.
 *
 * Sections (top to bottom):
 *   1. Header — org name, enterprise code (copy/regenerate), live pill
 *   2. KPI strip — staff, users, active-in-7d, spend-this-month, avg-dur
 *   3. People — Staff/Users tabs with invite popover
 *   4. Activity sparkline — daily sessions (30d)
 *   5. Recent sessions table (CSV export)
 *
 * Server-side filtering: every /api/enterprise/* route gates by
 * requireEnterpriseAdmin and scopes to the caller's organization_id.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy, RefreshCw, Plus, X, Search, Loader2, Download, Users as UsersIcon,
  Building2, Activity, Clock, Trash2, TrendingUp, Wallet,
} from "lucide-react";
import { formatEur } from "@/lib/billing/plans";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";

type OrgInfo = {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: string;
  enterpriseCode: string;
  createdAt: string;
};
type KPIs = {
  staffCount: number;
  userCount: number;
  sessions7Days: number;
  sessions30Days: number;
  activeIn7Days: number;
  liveNow: number;
  spendMonthCents: number;
  avgDurationMin: number;
};
type Member = {
  id: string;
  displayName: string;
  email: string;
  roles: string[];
  primaryRole: string;
  isStaff: boolean;
  status: "active" | "pending" | string;
  lastSignIn: string | null;
  createdAt: string;
};
type Session = {
  id: string;
  status: string;
  createdAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  chargeCents: number | null;
  customerName: string;
  engineerName: string;
  summaryTitle: string | null;
};

export function EnterpriseClient() {
  const [org, setOrg]     = useState<OrgInfo | null>(null);
  const [kpis, setKpis]   = useState<KPIs   | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/enterprise/me", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load org.");
      setOrg(body.org);
      setKpis(body.kpis);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load org.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }
  if (error || !org || !kpis) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-8">
        <p className="text-sm" style={{ color: "var(--accent-red)" }}>
          {error ?? "Couldn't load the enterprise console."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-8">
      <Header org={org} liveNow={kpis.liveNow} onCodeChanged={(code) => setOrg({ ...org, enterpriseCode: code })} />
      <KpiStrip kpis={kpis} />
      <BillingAndPeople orgName={org.name} onAfterInvite={loadMe} />
      <ActivitySparkline />
      <RecentSessions />
    </div>
  );
}

function BillingAndPeople({
  orgName, onAfterInvite,
}: {
  orgName: string;
  onAfterInvite: () => Promise<void>;
}) {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/enterprise/billing", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (body && !body.error) setData(body as BillingResponse);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <PeopleSection orgName={orgName} onAfterInvite={onAfterInvite} />
        {loading ? (
          <div
            className="flex items-center justify-center rounded-xl border"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            <Loader2 size={16} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : data ? (
          <RevenueCard revenue={data.revenue} rateEur={data.revenue.perMinuteCents / 100} />
        ) : null}
      </div>
    </div>
  );
}

/* ──────── Header: org + code + live pill ──────── */

function Header({
  org, liveNow, onCodeChanged,
}: {
  org: OrgInfo;
  liveNow: number;
  onCodeChanged: (code: string) => void;
}) {
  const [copied, setCopied]       = useState(false);
  const [rotating, setRotating]   = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(org.enterpriseCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  };

  const rotate = async () => {
    setRotating(true);
    try {
      const res = await fetch("/api/enterprise/regenerate-code", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Rotate failed.");
      onCodeChanged(body.enterpriseCode);
      setConfirmRotate(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't rotate the code.");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          {org.name}
        </h1>
        {liveNow > 0 && (
          <a
            href="/enterprise/supervise"
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium no-underline"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: BRAND_GREEN }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
            </span>
            {liveNow} live →
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
          Enterprise code
        </span>
        <code
          className="rounded-md border px-2.5 py-1 text-sm font-medium tracking-[0.08em]"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
            color: "var(--text)",
            fontFeatureSettings: "'tnum' 1",
          }}
        >
          {org.enterpriseCode}
        </code>
        <button
          onClick={copyCode}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
          title="Copy code"
        >
          <Copy size={11} />
          {copied ? "Copied" : "Copy"}
        </button>
        {confirmRotate ? (
          <>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Old code stops working immediately.
            </span>
            <button
              onClick={() => setConfirmRotate(false)}
              disabled={rotating}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => void rotate()}
              disabled={rotating}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              {rotating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {rotating ? "Rotating…" : "Confirm rotate"}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmRotate(true)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            title="Generate a new code"
          >
            <RefreshCw size={11} />
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}

/* ──────── KPI strip ──────── */

function KpiStrip({ kpis }: { kpis: KPIs }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiTile icon={Building2}  label="Staff"               value={kpis.staffCount} />
      <KpiTile icon={UsersIcon}  label="Users"               value={kpis.userCount} />
      <KpiTile icon={Activity}   label="Active in last 7d"   value={kpis.activeIn7Days} />
      <KpiTile icon={TrendingUp} label="Revenue this month"  value={formatEur(kpis.spendMonthCents)} />
      <KpiTile icon={Clock}      label="Avg call duration"   value={`${kpis.avgDurationMin}m`} />
    </div>
  );
}

function KpiTile({
  icon: Icon, label, value,
}: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-center gap-2">
        <Icon size={13} style={{ color: "var(--text-muted)" }} />
        <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      </div>
      <div
        className="mt-1.5 text-2xl font-semibold"
        style={{ color: "var(--text)", fontFeatureSettings: "'tnum' 1" }}
      >
        {value}
      </div>
    </div>
  );
}

/* ──────── People section: tabs + search + invite popover ──────── */

function PeopleSection({
  orgName, onAfterInvite,
}: {
  orgName: string;
  onAfterInvite: () => Promise<void>;
}) {
  const [scope, setScope] = useState<"staff" | "users">("users");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadMembers = useCallback(async (which: "staff" | "users") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/enterprise/users?scope=${which}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't load members.");
      setMembers(body.members as Member[]);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadMembers(scope); }, [scope, loadMembers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  const removeMember = async (m: Member) => {
    if (!confirm(`Remove ${m.displayName || m.email} from ${orgName}? This deletes their account.`)) return;
    const res = await fetch(`/api/enterprise/users/${m.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { alert(body.error ?? "Remove failed."); return; }
    await loadMembers(scope);
  };

  // Header counts are bound to live members list — recount on scope change
  // separately so tab labels never lag.
  const [counts, setCounts] = useState<{ staff: number; users: number } | null>(null);
  useEffect(() => {
    void (async () => {
      const [s, u] = await Promise.all([
        fetch("/api/enterprise/users?scope=staff").then((r) => r.json()).catch(() => ({ members: [] })),
        fetch("/api/enterprise/users?scope=users").then((r) => r.json()).catch(() => ({ members: [] })),
      ]);
      setCounts({ staff: s.members?.length ?? 0, users: u.members?.length ?? 0 });
    })();
  }, [members]);

  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>People</h2>
        </div>
        <div className="relative">
          <button
            onClick={() => setInviteOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <Plus size={11} />
            Invite
          </button>
          {inviteOpen && (
            <InvitePopover
              orgName={orgName}
              onClose={() => setInviteOpen(false)}
              onInvited={async () => {
                setInviteOpen(false);
                await onAfterInvite();
                await loadMembers(scope);
              }}
            />
          )}
        </div>
      </div>

      {/* Tabs + search */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-1">
          {(["staff", "users"] as const).map((s) => {
            const active = s === scope;
            const count = counts?.[s];
            return (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="rounded-md px-3 py-1 text-xs"
                style={{
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 500,
                  backgroundColor: active ? "color-mix(in srgb, var(--text) 5%, transparent)" : "transparent",
                }}
              >
                {s === "staff" ? "Staff" : "Users"}
                {count != null && <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>({count})</span>}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${scope}…`}
            className="rounded-md border py-1 pl-6 pr-2 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
              width: 200,
            }}
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          {query
            ? `No ${scope} match “${query}”.`
            : scope === "staff"
              ? "No staff yet. Use the Invite button to add managers."
              : "No users yet. Use the Invite button to add team members."}
        </p>
      ) : (
        <ul className="pb-2">
          {filtered.map((m) => <MemberRow key={m.id} member={m} onRemove={() => void removeMember(m)} />)}
        </ul>
      )}
    </div>
  );
}

function MemberRow({ member, onRemove }: { member: Member; onRemove: () => void }) {
  const isPending = member.status !== "active";
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
            color: "var(--text-muted)",
          }}
        >
          {(member.displayName || member.email || "?")[0]}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-2 truncate text-sm" style={{ color: "var(--text)" }}>
            {member.displayName || member.email || member.id}
            {isPending && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
              >
                Pending
              </span>
            )}
          </div>
          {member.email && (
            <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
              {member.email}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {prettyRole(member.primaryRole)}
        </span>
        <button
          onClick={onRemove}
          className="rounded-md p-1 transition-opacity hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
          title="Remove from organization"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

function prettyRole(role: string): string {
  switch (role) {
    case "enterprise_admin": return "Manager";
    case "client":           return "Member";
    case "department_admin": return "Department Admin";
    case "engineer":         return "Engineer";
    case "supervisor":       return "Supervisor";
    case "super_admin":      return "Super admin";
    default:                 return role || "—";
  }
}

/* ──────── Invite popover ──────── */

function InvitePopover({
  orgName, onClose, onInvited,
}: {
  orgName: string;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail]       = useState("");
  const [name, setName]         = useState("");
  const [role, setRole]         = useState<"manager" | "member">("member");
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  const submit = async () => {
    if (!email.trim() || !name.trim()) {
      setErr("Need name and email.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/enterprise/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), displayName: name.trim(), role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Invite failed.");
      await onInvited();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invite failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={popRef}
      className="absolute right-0 top-full z-20 mt-2 w-[340px] rounded-xl border p-4 shadow-lg"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Invite to {orgName}</h3>
        <button onClick={onClose} className="rounded-md p-0.5" style={{ color: "var(--text-muted)" }}>
          <X size={13} />
        </button>
      </div>
      <div className="mt-3 space-y-2.5">
        <Field label="Full name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@company.com"
            className="w-full rounded-md border px-2 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--text)" }}
          />
        </Field>
        <Field label="Role">
          <div className="grid grid-cols-2 gap-1">
            {(["manager", "member"] as const).map((r) => {
              const active = r === role;
              return (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className="rounded-md border px-2 py-1 text-[11px] capitalize"
                  style={{
                    borderColor: active ? BRAND_GREEN : "var(--border)",
                    color: active ? BRAND_GREEN : "var(--text)",
                    backgroundColor: active ? BRAND_GREEN_SOFT : "transparent",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            {role === "manager" && "Can manage other members in this org."}
            {role === "member"  && "Regular end-user — can start sessions."}
          </p>
        </Field>
      </div>
      {err && <p className="mt-2 text-[11px]" style={{ color: "var(--accent-red)" }}>{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !email.trim() || !name.trim()}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/* ──────── Activity sparkline (daily sessions, 30d) ──────── */

function ActivitySparkline() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    void (async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const res = await fetch(`/api/enterprise/sessions?limit=200&since=${encodeURIComponent(since)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({ sessions: [] }));
      setSessions((body.sessions ?? []) as Session[]);
      setLoading(false);
    })();
  }, []);

  // Bucket into 30 daily counts.
  const buckets = useMemo(() => {
    const out: { day: string; count: number }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      out.push({ day: d.toISOString().slice(0, 10), count: 0 });
    }
    const byDay = new Map(out.map((b) => [b.day, b]));
    for (const s of sessions) {
      const key = s.createdAt.slice(0, 10);
      const b = byDay.get(key);
      if (b) b.count += 1;
    }
    return out;
  }, [sessions]);

  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Activity</h2>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          Daily sessions over the last 30 days.
        </p>
      </div>
      <div className="p-5">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : (
          <ActivityLineChart buckets={buckets} max={max} />
        )}
      </div>
    </div>
  );
}

function ActivityLineChart({
  buckets, max,
}: {
  buckets: { day: string; count: number }[];
  max: number;
}) {
  const width  = 800;
  const height = 140;
  const padL   = 28;
  const padR   = 12;
  const padTop = 12;
  const padBot = 18;
  const innerW = width - padL - padR;
  const innerH = height - padTop - padBot;

  // Integer ticks from 0 up to max — capped to ~5 ticks for legibility.
  const tickStep = Math.max(1, Math.ceil(max / 5));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += tickStep) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);

  const yFor = (count: number) => padTop + (1 - count / max) * innerH;

  const points = buckets.map((b, i) => {
    const x = padL + (buckets.length === 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW);
    return { x, y: yFor(b.count), ...b };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-32 w-full"
      role="img"
      aria-label="Daily sessions over the last 30 days"
    >
      <defs>
        <linearGradient id="activity-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={BRAND_GREEN} stopOpacity="0.28" />
          <stop offset="100%" stopColor={BRAND_GREEN} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const y = yFor(t);
        return (
          <g key={i}>
            <line
              x1={padL} x2={width - padR} y1={y} y2={y}
              stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 3"
            />
            <text
              x={padL - 6} y={y + 3}
              textAnchor="end" fontSize="9"
              fill="var(--text-muted)"
              style={{ fontFeatureSettings: "'tnum' 1" }}
            >
              {t}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#activity-area)" />
      <path d={linePath} fill="none" stroke={BRAND_GREEN} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <title>{`${p.day}: ${p.count} session${p.count === 1 ? "" : "s"}`}</title>
          {p.count > 0 && <circle cx={p.x} cy={p.y} r="2.4" fill={BRAND_GREEN} />}
        </g>
      ))}
    </svg>
  );
}

/* ──────── Recent sessions table + CSV export ──────── */

function RecentSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/enterprise/sessions?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({ sessions: [] }));
      setSessions((body.sessions ?? []) as Session[]);
      setLoading(false);
    })();
  }, []);

  const exportCsv = () => {
    const header = ["When", "User", "Engineer", "Duration (min)", "Status", "Amount (EUR)", "Summary"];
    const rows = sessions.map((s) => [
      new Date(s.createdAt).toISOString(),
      s.customerName,
      s.engineerName,
      s.durationMinutes ?? "",
      s.status,
      s.chargeCents != null ? (s.chargeCents / 100).toFixed(2) : "",
      s.summaryTitle ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relay-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Recent sessions</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Last 5 calls across your organization.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={sessions.length === 0}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Download size={11} />
          Export CSV
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : sessions.length === 0 ? (
        <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No sessions yet. Once your users start calls, they&apos;ll appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: "var(--text-muted)" }}>
                <th className="px-5 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[10px]">When</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[10px]">User</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[10px]">Engineer</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em] text-[10px]">Dur</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em] text-[10px]">Status</th>
                <th className="px-5 py-2 text-right font-semibold uppercase tracking-[0.08em] text-[10px]">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-5 py-2" style={{ color: "var(--text-muted)" }}>
                    {new Date(s.createdAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text)" }}>{s.customerName || "—"}</td>
                  <td className="px-3 py-2" style={{ color: "var(--text)" }}>{s.engineerName || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text)" }}>
                    {s.durationMinutes != null ? `${Math.round(Number(s.durationMinutes))}m` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: s.status === "live" || s.status === "joining"
                          ? BRAND_GREEN_SOFT
                          : "color-mix(in srgb, var(--text-muted) 12%, transparent)",
                        color: s.status === "live" || s.status === "joining"
                          ? BRAND_GREEN
                          : "var(--text-muted)",
                      }}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums" style={{ color: "var(--text)" }}>
                    {formatEur(s.chargeCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ──────── Billing: revenue + plan + transactions ──────── */

type BillingResponse = {
  currency: string;
  revenue: {
    thisMonthCents:  number;
    last30DaysCents: number;
    lifetimeCents:   number;
    perMinuteCents:  number;
  };
  plan: {
    tier:                 string;
    name:                 string;
    description:          string;
    monthlyPriceCents:    number | null;
    includedSeats:        number | null;
    features:             string[];
    status:               string;
    currentPeriodEnd:     string | null;
    stripeCustomerId:     string | null;
    stripeSubscriptionId: string | null;
  };
  recentTransactions: Array<{
    id:           string;
    occurredAt:   string;
    label:        string;
    durationMin:  number;
    amountCents:  number;
    kind:         "session_revenue";
  }>;
};

function RevenueCard({
  revenue, rateEur,
}: {
  revenue: BillingResponse["revenue"];
  rateEur: number;
}) {
  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Wallet size={14} style={{ color: "var(--text-muted)" }} />
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Revenue</h3>
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Earned from customer call minutes · €{rateEur}/min
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        <RevenueTile label="This month"      cents={revenue.thisMonthCents}  />
        <RevenueTile label="Last 30 days"    cents={revenue.last30DaysCents} />
        <RevenueTile label="Lifetime"        cents={revenue.lifetimeCents}   />
      </div>
    </div>
  );
}

function RevenueTile({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div
        className="mt-1 text-xl font-semibold tabular-nums"
        style={{ color: "var(--text)", fontFeatureSettings: "'tnum' 1" }}
      >
        {formatEur(cents)}
      </div>
    </div>
  );
}

