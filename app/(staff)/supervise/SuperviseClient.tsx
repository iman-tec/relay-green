"use client";

/*
 * Supervisor live grid.
 * Shows every active session in the org as a tile. Click a tile to enter
 * observer mode (read-only chat + zoom view) at /staff/session/:id.
 *
 * Top metrics: active count, urgent count, avg wait, longest wait.
 * Updates every second + on any guest_calls change via Realtime.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  Activity, AlertTriangle, Clock, Eye, Loader2, ArrowUpRight, Search,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#d4a017";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const CRIT_RED = "#8b1a1a";
const CRIT_RED_SOFT = "rgba(139, 26, 26, 0.18)";

const ACTIVE_STATES  = ["queued", "assigned", "joining", "live", "grace"];
const LIVE_STATES    = new Set(["live", "joining", "grace"]);
const WAITING_STATES = new Set(["queued", "assigned"]);
const PAST_STATES    = ["ended", "cancelled", "abandoned"];

// Per-session AI health snapshot, merged onto GuestCall in the card grid.
// Sourced from latest_session_health (DISTINCT ON session_id) — one row
// per active session reflecting the most recent score-session-health tick.
type HealthSnapshot = {
  score: number;
  summary: string;
  computed_at: string;
  message_count?: number;
};
type SessionWithHealth = GuestCall & { health?: HealthSnapshot };

// Minimum chat messages required before we trust the AI verdict. Below
// this, fall back to deterministic — the LLM has nothing useful to read
// (most conversations happen on Zoom voice, not chat).
const MIN_MESSAGES_FOR_AI = 2;

type Tab = "live" | "waiting" | "past";

export function SuperviseClient() {
  const [sessions, setSessions] = useState<SessionWithHealth[]>([]);
  const [pastSessions, setPastSessions] = useState<SessionWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("live");
  const [, setTick] = useState(0);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    const sb = supabaseRef.current;
    // Phase 1: every supervisor / admin sees ALL active calls org-wide.
    // Phase 1.5 (future): scope to the caller's hierarchy —
    //   pod_lead     → engineers in their pod
    //   ops_manager  → engineers in their region/team
    //   admin        → enterprise's engineers
    //   super_admin  → everything (no filter)
    // The hook for that filter lives right here: add a .eq("pod_id", …)
    // or join-with-engineer_pods once that schema exists.
    const [liveRes, pastRes] = await Promise.all([
      sb.from("guest_calls").select("*")
        .in("status", ACTIVE_STATES)
        .order("created_at", { ascending: false })
        .limit(100),
      sb.from("guest_calls").select("*")
        .in("status", PAST_STATES)
        .order("ended_at", { ascending: false, nullsFirst: false })
        .limit(200),
    ]);
    const rows     = (liveRes.data as GuestCall[]) ?? [];
    const pastRows = (pastRes.data as GuestCall[]) ?? [];

    // Pull the latest AI health snapshot for every visible session (live
    // + past) in one round-trip. Missing rows just mean "not scored yet"
    // — the live card falls back to deterministic colour via deriveHealth;
    // past cards stay neutral grey when there's no post-session score.
    const allIds = [...rows.map((s) => s.id), ...pastRows.map((s) => s.id)];
    let healthMap = new Map<string, HealthSnapshot>();
    if (allIds.length > 0) {
      const { data: healths } = await sb
        .from("latest_session_health")
        .select("session_id, score, summary, computed_at, message_count")
        .in("session_id", allIds);
      healthMap = new Map(
        (healths ?? []).map((h: { session_id: string; score: number; summary: string; computed_at: string; message_count?: number }) =>
          [h.session_id, {
            score:         Number(h.score),
            summary:       h.summary,
            computed_at:   h.computed_at,
            message_count: h.message_count,
          }],
        ),
      );
    }

    setSessions(rows.map((s) => ({ ...s, health: healthMap.get(s.id) })));
    setPastSessions(pastRows.map((s) => ({ ...s, health: healthMap.get(s.id) })));
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  // Tick every second so wait timers update live
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime: re-fetch on any change to guest_calls (new session, status
  // flip, agent claimed, etc.) AND on any new session_health row (the
  // per-minute AI score landing). Falls back to a 30s poll in case
  // Realtime drops, so the supervisor view never goes stale.
  //
  // Bursts of postgres_changes events can fire ~10 times per second during
  // a busy minute (every recall, every assignment, every status flip). We
  // debounce them to one refetch per 600 ms so we don't spam the DB and
  // keep the UI smooth.
  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; void refresh(); }, 600);
    };
    const ch = sb
      .channel("relay-supervise")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        queueRefresh)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "session_health" },
        queueRefresh)
      .subscribe();
    channelRef.current = ch;
    const fallback = setInterval(() => { void refresh(); }, 30_000);
    return () => {
      if (pending) clearTimeout(pending);
      sb.removeChannel(ch);
      channelRef.current = null;
      clearInterval(fallback);
    };
  }, []);

  const metrics = useMemo(() => {
    const active = sessions.length;
    const urgent = sessions.filter((s) => s.urgency !== "normal").length;
    const live = sessions.filter((s) => s.status === "live").length;
    const queued = sessions.filter((s) => s.status === "queued");
    const avgWait = queued.length === 0 ? 0 : Math.floor(
      queued.reduce((sum, s) => sum + (Date.now() - new Date(s.created_at).getTime()) / 1000, 0) / queued.length,
    );
    const longestWait = queued.length === 0 ? 0 : Math.max(
      ...queued.map((s) => Math.floor((Date.now() - new Date(s.created_at).getTime()) / 1000)),
    );
    return { active, urgent, live, avgWait, longestWait };
  }, [sessions]);

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          Live operations
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Every active session, live. The colored bar is the session&apos;s
          current health — green is healthy, amber is shaky, red is at risk.
          Use Join to drop into a session.
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-5">
        <Metric icon={Activity} label="Active sessions" value={metrics.active} accent={BRAND_GREEN} bg={BRAND_GREEN_SOFT} />
        <Metric icon={Activity} label="Live now"        value={metrics.live}   accent={BRAND_GREEN} bg={BRAND_GREEN_SOFT} />
        <Metric icon={AlertTriangle} label="Urgent"     value={metrics.urgent} accent={URGENT_AMBER} bg={URGENT_AMBER_SOFT} />
        <Metric icon={Clock} label="Avg wait"           value={fmtSecs(metrics.avgWait)} accent="#0284c7" bg="rgba(2, 132, 199, 0.12)" />
        <div className="flex flex-col">
          <Metric icon={Clock} label="Longest wait"     value={fmtSecs(metrics.longestWait)} accent="#7c3aed" bg="rgba(124, 58, 237, 0.12)" />
          <HealthLegend />
        </div>
      </div>

      {/* Tabs: Live · Waiting · Past */}
      <Tabs tab={tab} setTab={setTab} counts={{
        live:    sessions.filter((s) => LIVE_STATES.has(s.status)).length,
        waiting: sessions.filter((s) => WAITING_STATES.has(s.status)).length,
        past:    pastSessions.length,
      }} />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : (
        <TabPanel
          tab={tab}
          liveSessions={sessions.filter((s) => LIVE_STATES.has(s.status))}
          waitingSessions={sessions.filter((s) => WAITING_STATES.has(s.status))}
          pastSessions={pastSessions}
        />
      )}
    </div>
  );
}

function HealthLegend() {
  return (
    <div className="px-1 pb-1 pt-3" title="Session health — green healthy, amber neutral, red danger">
      <div
        className="h-2 w-full rounded-full"
        style={{
          background: `linear-gradient(to right, ${BRAND_GREEN} 0%, ${URGENT_AMBER} 50%, ${CRIT_RED} 100%)`,
        }}
      />
      <div className="mt-1.5 flex justify-between text-[9px] font-medium uppercase tracking-wider">
        <span style={{ color: BRAND_GREEN }}>Healthy</span>
        <span style={{ color: URGENT_AMBER }}>Neutral</span>
        <span style={{ color: CRIT_RED }}>Danger</span>
      </div>
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

// Health verdict.
//   • If the score-session-health edge function has produced a recent
//     sentiment score for this session, that wins — buckets it into
//     red (< -0.3), amber (-0.3..0.3), green (>= 0.3).
//   • Otherwise (no score yet — first ~60s, or queued session with no
//     chat), fall back to the deterministic verdict from session fields.
type Health = "green" | "amber" | "red";
function deriveHealth(s: SessionWithHealth): Health {
  const score = s.health?.score;
  const msgs  = s.health?.message_count ?? 0;
  // Trust the AI verdict only when there's enough chat to read. Below the
  // threshold, the LLM is guessing from "(no messages)" and returning
  // score=0, which would flag every voice-only call as AMBER. Fall back
  // to the deterministic verdict instead — it's based on urgency,
  // recalls, and wait time, which are real signals.
  if (typeof score === "number" && Number.isFinite(score) && msgs >= MIN_MESSAGES_FOR_AI) {
    if (score < -0.3) return "red";
    if (score <  0.3) return "amber";
    return "green";
  }
  return deriveHealthDeterministic(s);
}
function deriveHealthDeterministic(s: GuestCall): Health {
  if (s.urgency === "critical")     return "red";
  if (s.status === "grace")         return "red";
  if (s.status === "expired_free")  return "amber";
  if (s.urgency === "urgent")       return "amber";
  if ((s.recall_count ?? 0) >= 2)   return "red";
  if ((s.recall_count ?? 0) >= 1)   return "amber";
  if (s.status === "queued" && s.created_at) {
    const waitSecs = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 1000);
    if (waitSecs >= 180) return "red";
    if (waitSecs >= 60)  return "amber";
  }
  return "green";
}

const HEALTH_TOKENS: Record<Health, { bar: string; pill_bg: string; pill_fg: string; label: string }> = {
  green: { bar: BRAND_GREEN,  pill_bg: BRAND_GREEN_SOFT,  pill_fg: BRAND_GREEN,  label: "Healthy" },
  amber: { bar: URGENT_AMBER, pill_bg: URGENT_AMBER_SOFT, pill_fg: URGENT_AMBER, label: "Watch"   },
  red:   { bar: CRIT_RED,     pill_bg: CRIT_RED_SOFT,     pill_fg: CRIT_RED,     label: "At risk" },
};

function SessionTile({ session }: { session: SessionWithHealth }) {
  const router = useRouter();
  const health = deriveHealth(session);
  const tok    = HEALTH_TOKENS[health];
  const aiMessageCount = session.health?.message_count ?? 0;
  // Only surface the AI summary line when the score was derived from real
  // chat. Otherwise it just shows "Quiet — no signal yet." which is noise.
  const aiSummary = aiMessageCount >= MIN_MESSAGES_FOR_AI ? session.health?.summary : undefined;
  const aiScore   = aiMessageCount >= MIN_MESSAGES_FOR_AI ? session.health?.score   : undefined;

  const elapsed = session.joined_at
    ? Math.floor((Date.now() - new Date(session.joined_at).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000);

  const join = () => router.push(`/staff/session/${session.id}`);

  return (
    <div
      // Whole card is still clickable (preserves the existing "click to
      // observe" affordance) but the Join button is the explicit CTA.
      onClick={join}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); join(); } }}
      className="group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition-colors hover:border-[var(--text-muted)]/40"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {/* Left accent bar — at-a-glance health indicator */}
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
          {session.status}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: tok.pill_bg, color: tok.pill_fg }}
          title={`Session health: ${tok.label}`}
        >
          {health !== "green" && <AlertTriangle size={10} />}
          {tok.label}
        </span>
      </div>

      <div className="mb-3">
        <div className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {session.guest_name}
        </div>
        <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {session.guest_email}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
        <Stat label={session.status === "live" ? "Live for" : "Waiting"} value={fmtSecs(elapsed)} />
        <Stat label="Recalls" value={String(session.recall_count ?? 0)} />
        <Stat label="Engineer" value={session.agent_name ?? "—"} />
        <Stat label="Project" value={session.project_name ?? "—"} />
      </div>

      {/* AI sentiment summary — present once score-session-health has run
       *  at least once for this session (~1 min after it starts). */}
      {aiSummary && (
        <div
          className="mb-4 rounded-md border px-2.5 py-2 text-[11px] leading-snug"
          style={{
            borderColor: tok.pill_bg,
            backgroundColor: tok.pill_bg,
            color: tok.pill_fg,
          }}
          title={typeof aiScore === "number" ? `Sentiment score: ${aiScore.toFixed(2)}` : undefined}
        >
          <span className="font-semibold uppercase tracking-wide opacity-80">AI · </span>
          {aiSummary}
        </div>
      )}

      {/* Explicit Join CTA. Stop propagation so clicking the button
       *  doesn't double-fire on top of the card-level onClick. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); join(); }}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold transition-opacity hover:opacity-90"
        style={{ backgroundColor: tok.bar, color: "#fff" }}
      >
        <Eye size={12} />
        Join session
        <ArrowUpRight size={11} className="opacity-80" />
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-xs font-medium" style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}

// ── Tabs (Live · Waiting · Past) ───────────────────────────────────────────
function Tabs({
  tab, setTab, counts,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: Record<Tab, number>;
}) {
  return (
    <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--border)" }}>
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
  );
}

// ── Tab panel — chooses the right grid for the active tab ─────────────────
function TabPanel({
  tab, liveSessions, waitingSessions, pastSessions,
}: {
  tab: Tab;
  liveSessions: SessionWithHealth[];
  waitingSessions: SessionWithHealth[];
  pastSessions: SessionWithHealth[];
}) {
  if (tab === "past") {
    return (
      <PastPanel sessions={pastSessions} />
    );
  }
  return (
    <ActivePanel
      tab={tab}
      sessions={tab === "live" ? liveSessions : waitingSessions}
    />
  );
}

// ── Active (live + waiting) panel — search + sort, no pager (lists short) ──
function ActivePanel({ tab, sessions }: { tab: "live" | "waiting"; sessions: SessionWithHealth[] }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"recent" | "wait" | "customer" | "engineer">(
    tab === "waiting" ? "wait" : "recent",
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = sessions;
    if (needle) {
      arr = arr.filter((s) =>
        (s.guest_name ?? "").toLowerCase().includes(needle) ||
        (s.guest_email ?? "").toLowerCase().includes(needle) ||
        (s.agent_name ?? "").toLowerCase().includes(needle) ||
        (s.project_name ?? "").toLowerCase().includes(needle),
      );
    }
    const sorted = [...arr];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "wait": {
          const aw = Date.now() - new Date(a.created_at).getTime();
          const bw = Date.now() - new Date(b.created_at).getTime();
          return bw - aw; // longest wait first
        }
        case "customer": return (a.guest_name ?? "").localeCompare(b.guest_name ?? "");
        case "engineer": return (a.agent_name ?? "").localeCompare(b.agent_name ?? "");
        case "recent":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return sorted;
  }, [sessions, q, sortKey]);

  return (
    <div className="flex flex-col gap-3">
      <SuperviseToolbar
        q={q} setQ={setQ}
        sortKey={sortKey} setSortKey={setSortKey as (s: string) => void}
        sortOptions={[
          { value: "recent",   label: "Newest first" },
          { value: "wait",     label: "Longest wait" },
          { value: "customer", label: "Customer name" },
          { value: "engineer", label: "Engineer name" },
        ]}
        total={filtered.length}
        searchPlaceholder={tab === "live" ? "Search live sessions…" : "Search waiting…"}
      />
      {filtered.length === 0 ? (
        tab === "live"
          ? <EmptyState title="All quiet" body={q ? `No live sessions match "${q}".` : "No active sessions right now."} />
          : <EmptyState title="Nothing waiting" body={q ? `No waiting sessions match "${q}".` : "No customers waiting to be picked up."} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((s) => <SessionTile key={s.id} session={s} />)}
        </div>
      )}
    </div>
  );
}

// ── Past panel — search + sort + pager (longer list) ──────────────────────
function PastPanel({ sessions }: { sessions: SessionWithHealth[] }) {
  const PAGE_SIZE = 8;
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"ended" | "duration" | "sentiment" | "customer">("ended");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = sessions;
    if (needle) {
      arr = arr.filter((s) =>
        (s.guest_name ?? "").toLowerCase().includes(needle) ||
        (s.guest_email ?? "").toLowerCase().includes(needle) ||
        (s.agent_name ?? "").toLowerCase().includes(needle) ||
        (s.project_name ?? "").toLowerCase().includes(needle),
      );
    }
    const sorted = [...arr];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "duration":  return (Number(b.duration_minutes ?? 0)) - (Number(a.duration_minutes ?? 0));
        case "sentiment": return (b.health?.score ?? 0) - (a.health?.score ?? 0);
        case "customer":  return (a.guest_name ?? "").localeCompare(b.guest_name ?? "");
        case "ended":
        default: {
          const at = a.ended_at ? new Date(a.ended_at).getTime() : 0;
          const bt = b.ended_at ? new Date(b.ended_at).getTime() : 0;
          return bt - at;
        }
      }
    });
    return sorted;
  }, [sessions, q, sortKey]);

  // Reset page if filters shrink the list past the current page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <SuperviseToolbar
        q={q} setQ={(v) => { setQ(v); setPage(1); }}
        sortKey={sortKey} setSortKey={(s) => { setSortKey(s as typeof sortKey); setPage(1); }}
        sortOptions={[
          { value: "ended",     label: "Newest ended" },
          { value: "duration",  label: "Longest duration" },
          { value: "sentiment", label: "Best sentiment" },
          { value: "customer",  label: "Customer name" },
        ]}
        total={filtered.length}
        searchPlaceholder="Search past sessions…"
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={sessions.length === 0 ? "No history yet" : "No matches"}
          body={sessions.length === 0
            ? "Once a session ends, it'll appear here."
            : `No past sessions match "${q}".`}
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {slice.map((s) => <PastSessionTile key={s.id} session={s} />)}
          </div>
          <PagerStrip
            showingFrom={start + 1}
            showingTo={start + slice.length}
            total={filtered.length}
            page={page}
            pageCount={pageCount}
            setPage={setPage}
          />
        </>
      )}
    </div>
  );
}

// ── Shared toolbar: search + sort + count ──────────────────────────────────
function SuperviseToolbar({
  q, setQ, sortKey, setSortKey, sortOptions, total, searchPlaceholder,
}: {
  q: string;
  setQ: (v: string) => void;
  sortKey: string;
  setSortKey: (k: string) => void;
  sortOptions: ReadonlyArray<{ value: string; label: string }>;
  total: number;
  searchPlaceholder: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative">
        <Search
          size={12}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="rounded-md border py-1.5 pl-7 pr-2 text-xs outline-none"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--background)",
            color: "var(--text)",
            width: 260,
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--background)",
            color: "var(--text)",
          }}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>Sort: {o.label}</option>
          ))}
        </select>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {total} {total === 1 ? "result" : "results"}
        </span>
      </div>
    </div>
  );
}

// ── Pager strip (used by Past tab) ─────────────────────────────────────────
function PagerStrip({
  showingFrom, showingTo, total, page, pageCount, setPage,
}: {
  showingFrom: number;
  showingTo:   number;
  total:       number;
  page:        number;
  pageCount:   number;
  setPage:     (p: number) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Showing {showingFrom}–{showingTo} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PagerBtn onClick={() => setPage(1)}              disabled={page <= 1}><ChevronsLeft  size={12} /></PagerBtn>
        <PagerBtn onClick={() => setPage(page - 1)}       disabled={page <= 1}><ChevronLeft   size={12} /></PagerBtn>
        <span className="px-2 text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {page} / {pageCount}
        </span>
        <PagerBtn onClick={() => setPage(page + 1)}       disabled={page >= pageCount}><ChevronRight  size={12} /></PagerBtn>
        <PagerBtn onClick={() => setPage(pageCount)}      disabled={page >= pageCount}><ChevronsRight size={12} /></PagerBtn>
      </div>
    </div>
  );
}

function PagerBtn({
  onClick, disabled, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded-md border transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-xl border border-dashed px-6 py-16 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{title}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{body}</p>
    </div>
  );
}

// ── Past session tile ──────────────────────────────────────────────────────
// Renders a finished session. The colored accent bar reflects the
// post-completion sentiment score (latest_session_health row written by
// summarize-guest-call). When no score is available (the LLM bailed or the
// session ended before summary), we render a neutral grey bar.
function PastSessionTile({ session }: { session: SessionWithHealth }) {
  const router = useRouter();
  const score  = session.health?.score;
  const hasScore = typeof score === "number" && Number.isFinite(score);
  // Post-completion thresholds match the live thresholds (±0.3) so the
  // colour mapping stays consistent across the two grids.
  const sentiment: Health | "neutral" = !hasScore
    ? "neutral"
    : score! >= 0.3 ? "green"
    : score! > -0.3 ? "amber"
    : "red";
  const sentimentLabel =
    sentiment === "green"   ? "Positive"
    : sentiment === "amber" ? "Neutral"
    : sentiment === "red"   ? "Negative"
    :                          "Not scored";

  const barColor =
    sentiment === "neutral"
      ? "color-mix(in srgb, var(--text-muted) 30%, transparent)"
      : HEALTH_TOKENS[sentiment as Health].bar;

  const ended = session.ended_at ?? session.created_at;
  const durationMin = session.duration_minutes ?? null;

  const open = () => router.push(`/staff/session/${session.id}`);

  return (
    <div
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      className="group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition-colors hover:border-[var(--text-muted)]/40"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {/* Left accent bar — colour = post-completion sentiment */}
      <div
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: barColor }}
      />

      {/* Header row — pill + score (mirrors SessionTile spacing) */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text-muted) 12%, transparent)",
            color: "var(--text-muted)",
          }}
        >
          {session.status}
        </span>
        {hasScore && (
          <span
            className="text-[10px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
            title={`sentiment score ${score!.toFixed(2)}`}
          >
            {(score! >= 0 ? "+" : "")}{score!.toFixed(2)}
          </span>
        )}
      </div>

      {/* Customer (matches SessionTile typography: base + xs) */}
      <div className="mb-3">
        <div className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {session.guest_name || "Customer"}
        </div>
        <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {session.guest_email || ""}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
        <Stat label="Ended" value={new Date(ended).toLocaleString(undefined, {
          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        })} />
        <Stat label="Duration" value={durationMin != null ? `${Math.round(Number(durationMin))} min` : "—"} />
        <Stat label="Engineer" value={session.agent_name || "—"} />
        <Stat label="Project" value={session.project_name || "—"} />
      </div>

      {/* Post-completion sentiment caption */}
      <div className="rounded-md border px-2.5 py-2 text-[11px] leading-snug"
        style={{
          borderColor: sentiment === "neutral"
            ? "var(--border)"
            : HEALTH_TOKENS[sentiment as Health].pill_bg,
          backgroundColor: sentiment === "neutral"
            ? "color-mix(in srgb, var(--text-muted) 6%, transparent)"
            : HEALTH_TOKENS[sentiment as Health].pill_bg,
          color: sentiment === "neutral"
            ? "var(--text-muted)"
            : HEALTH_TOKENS[sentiment as Health].pill_fg,
        }}
      >
        <span className="font-semibold uppercase tracking-wide opacity-80">
          Post-completion · {sentimentLabel}
          {session.health?.summary ? " — " : ""}
        </span>
        {session.health?.summary ?? (hasScore ? "" : "no summary available")}
      </div>
    </div>
  );
}

function fmtSecs(s: number) {
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
