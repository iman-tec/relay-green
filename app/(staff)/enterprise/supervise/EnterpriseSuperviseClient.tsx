"use client";

/*
 * Enterprise Admin supervise pit — read-only, scoped to the caller's
 * organization. Mirrors the platform /supervise card design but without
 * the engineer "Join session" CTA (enterprise admins don't enter staff
 * session rooms).
 *
 * Tabs:
 *   Live (status ∈ live, joining, grace)
 *   Waiting (status ∈ queued, assigned)
 *   Past (status ∈ ended, cancelled, abandoned)
 *
 * Top metrics row mirrors /supervise: active, live, urgent, avg wait,
 * longest wait.
 */

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, Loader2 } from "lucide-react";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "var(--primary-soft)";
const URGENT_AMBER = "var(--warn)";
const URGENT_AMBER_SOFT = "var(--warn-soft)";
// Danger colour — was #8b1a1a (deep red), softened to a deep orange so the
// dark-theme palette stops shouting while keeping clear separation from amber.
const CRIT_RED          = "#c2410c";
const CRIT_RED_SOFT     = "rgba(194, 65, 12, 0.18)";

type Session = {
  id: string;
  status: string;
  urgency: string;
  recallCount: number;
  createdAt: string;
  joinedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  chargeCents: number | null;
  customerName: string;
  customerEmail: string;
  engineerName: string;
  projectName: string | null;
  summaryTitle: string | null;
};

const LIVE    = new Set(["live", "joining", "grace"]);
const WAITING = new Set(["queued", "assigned"]);
const PAST    = new Set(["ended", "cancelled", "abandoned"]);

type Health = "green" | "amber" | "red";
function deriveHealth(s: Session): Health {
  if (s.urgency === "critical")     return "red";
  if (s.status === "grace")         return "red";
  if (s.status === "expired_free")  return "amber";
  if (s.urgency === "urgent")       return "amber";
  if (s.recallCount >= 2)           return "red";
  if (s.recallCount >= 1)           return "amber";
  if (s.status === "queued" && s.createdAt) {
    // Mirrors SuperviseClient — queue timeout is 90s, so red kicks in at
    // 60s (about-to-time-out) and amber at 30s.
    const waitSecs = Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 1000);
    if (waitSecs >= 60) return "red";
    if (waitSecs >= 30) return "amber";
  }
  return "green";
}

const HEALTH_TOKENS: Record<Health, { bar: string; pill_bg: string; pill_fg: string; label: string }> = {
  green: { bar: BRAND_GREEN,  pill_bg: BRAND_GREEN_SOFT,  pill_fg: BRAND_GREEN,  label: "Healthy" },
  amber: { bar: URGENT_AMBER, pill_bg: URGENT_AMBER_SOFT, pill_fg: URGENT_AMBER, label: "Watch"   },
  red:   { bar: CRIT_RED,     pill_bg: CRIT_RED_SOFT,     pill_fg: CRIT_RED,     label: "At risk" },
};

function fmtSecs(s: number): string {
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function EnterpriseSuperviseClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"live" | "waiting" | "past">("live");
  const [, setTick]             = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      const res = await fetch("/api/enterprise/sessions?limit=200", { cache: "no-store" });
      const body = await res.json().catch(() => ({ sessions: [] }));
      if (!cancelled) {
        setSessions((body.sessions ?? []) as Session[]);
        setLoading(false);
      }
    };
    void fetchOnce();
    const interval = setInterval(fetchOnce, 8_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // 1-second tick keeps the "live for" / "waiting" timers ticking up.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { live, waiting, past } = useMemo(() => {
    const live: Session[]    = [];
    const waiting: Session[] = [];
    const past: Session[]    = [];
    for (const s of sessions) {
      if (LIVE.has(s.status))         live.push(s);
      else if (WAITING.has(s.status)) waiting.push(s);
      else if (PAST.has(s.status))    past.push(s);
    }
    return { live, waiting, past };
  }, [sessions]);

  const metrics = useMemo(() => {
    const activeSessions = [...live, ...waiting];
    const urgent = activeSessions.filter((s) => s.urgency !== "normal").length;
    const queued = waiting.filter((s) => s.status === "queued");
    const avgWait = queued.length === 0 ? 0 : Math.floor(
      queued.reduce((sum, s) => sum + (Date.now() - new Date(s.createdAt).getTime()) / 1000, 0) / queued.length,
    );
    const longestWait = queued.length === 0 ? 0 : Math.max(
      ...queued.map((s) => Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 1000)),
    );
    return {
      active:      activeSessions.length,
      live:        live.length,
      urgent,
      avgWait,
      longestWait,
    };
  }, [live, waiting]);

  const counts = { live: live.length, waiting: waiting.length, past: past.length };
  const visible = tab === "live" ? live : tab === "waiting" ? waiting : past;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Supervise</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Live, waiting, and past calls from your organization. The colored
          bar on each card is the session&apos;s health — green is healthy,
          amber is shaky, red is at risk.
        </p>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric icon={Activity}      label="Active sessions" value={metrics.active}            accent={BRAND_GREEN}  bg={BRAND_GREEN_SOFT} />
        <Metric icon={Activity}      label="Live now"        value={metrics.live}              accent={BRAND_GREEN}  bg={BRAND_GREEN_SOFT} />
        <Metric icon={AlertTriangle} label="Urgent"          value={metrics.urgent}            accent={URGENT_AMBER} bg={URGENT_AMBER_SOFT} />
        <Metric icon={Clock}         label="Avg wait"        value={fmtSecs(metrics.avgWait)}     accent="#0284c7"   bg="rgba(2, 132, 199, 0.12)" />
        <Metric icon={Clock}         label="Longest wait"    value={fmtSecs(metrics.longestWait)} accent="#7c3aed"   bg="rgba(124, 58, 237, 0.12)" />
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        {(["live", "waiting", "past"] as const).map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="relative px-3 py-2 text-sm capitalize transition-colors"
              style={{
                color: active ? "var(--text)" : "var(--text-muted)",
                fontWeight: active ? 600 : 500,
              }}
            >
              {t}
              <span className="ml-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                ({counts[t]})
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute -bottom-px left-2 right-2 h-[2px] rounded-t-sm"
                  style={{ backgroundColor: BRAND_GREEN }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : visible.length === 0 ? (
        <div
          className="rounded-xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {tab === "live"    && "All quiet"}
            {tab === "waiting" && "Nothing waiting"}
            {tab === "past"    && "No history yet"}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {tab === "live"    && "No active calls in your org right now. New activity appears here in real time."}
            {tab === "waiting" && "No calls queued to be picked up."}
            {tab === "past"    && "Once your users have a session, it'll appear here once it ends."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((s) => <SessionCard key={s.id} session={s} isPast={PAST.has(s.status)} />)}
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon, label, value, accent, bg,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent: string;
  bg: string;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: bg, color: accent }}
      >
        <Icon size={16} />
      </div>
      <div>
        <div className="text-xl font-bold tabular-nums" style={{ color: "var(--text)" }}>
          {value}
        </div>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session: s, isPast }: { session: Session; isPast: boolean }) {
  const health = isPast ? "green" : deriveHealth(s);
  const tok    = HEALTH_TOKENS[health];

  // Live timer if the session has joined; otherwise count from created_at
  // (used for queued/assigned wait time). For past sessions we render the
  // total duration_minutes already on the record.
  const elapsedSecs = isPast
    ? Math.floor((s.durationMinutes ?? 0) * 60)
    : s.joinedAt
      ? Math.floor((Date.now() - new Date(s.joinedAt).getTime()) / 1000)
      : Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 1000);

  return (
    <div
      className="relative overflow-hidden rounded-xl border p-4"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {/* Left accent bar */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: tok.bar }}
      />

      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: tok.pill_bg, color: tok.pill_fg }}
        >
          {s.status}
        </span>
        {!isPast && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: tok.pill_bg, color: tok.pill_fg }}
            title={`Session health: ${tok.label}`}
          >
            {health !== "green" && <AlertTriangle size={10} />}
            {tok.label}
          </span>
        )}
      </div>

      <div className="mb-3">
        <div className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {s.customerName || "Anonymous user"}
        </div>
        {s.customerEmail && (
          <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {s.customerEmail}
          </div>
        )}
      </div>

      <div
        className="mb-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs"
        style={{ borderColor: "var(--border)" }}
      >
        <Stat
          label={isPast ? "Duration" : s.status === "live" ? "Live for" : "Waiting"}
          value={fmtSecs(elapsedSecs)}
        />
        <Stat label="Recalls"  value={String(s.recallCount)} />
        <Stat label="Engineer" value={s.engineerName || "—"} />
        <Stat label="Project"  value={s.projectName || "—"} />
      </div>

      {s.summaryTitle && (
        <div
          className="mb-1 rounded-md border px-2.5 py-2 text-[11px] leading-snug"
          style={{
            borderColor: tok.pill_bg,
            backgroundColor: tok.pill_bg,
            color: tok.pill_fg,
          }}
        >
          <span className="font-semibold uppercase tracking-wide opacity-80">AI · </span>
          {s.summaryTitle}
        </div>
      )}

      {isPast && s.chargeCents != null && (
        <div className="mt-2 flex justify-end text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          ${(s.chargeCents / 100).toFixed(2)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-xs font-medium" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}
