"use client";

/*
 * Supervisor live grid.
 * Shows every active session in the org as a tile. Click a tile to enter
 * observer mode (read-only chat + zoom view) at /staff/session/:id.
 *
 * Top metrics: active count, urgent count, avg wait, longest wait.
 * Updates every second + on any guest_calls change via Realtime.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  AlertTriangle, Eye, Loader2, ArrowUpRight, Search,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { humanState } from "@/lib/relay/session-status";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#d4a017";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
// "Critical" colour used to be a deep red (#8b1a1a) but read as too loud on
// dark backgrounds. Swapped to a deep orange so the green → amber → danger
// gradient still has clear separation without the alarm-bell feel.
const CRIT_RED = "#c2410c";
const CRIT_RED_SOFT = "rgba(194, 65, 12, 0.18)";

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

type Tab = "all" | "waiting" | "live" | "past";

// Per-page selector — shared by all three panels (All, Active, Past). Lifted
// to the parent so changing "20 / page" once stays applied as you tab around.
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 20;

// Pager slot — each panel renders its PagerStrip into the right-hand side
// of the sticky footer via this portal target. Lets the panels keep owning
// their pagination state while visually sharing the footer with HealthLegend.
const PagerSlotContext = createContext<HTMLElement | null>(null);

// Pulsing-glow animation for sessions currently in a waiting state
// (queued / assigned). The card grows a fading halo and the status chip
// breathes with the same colour cue so the supervisor's eye is drawn to
// customers who still need to be picked up. Color is driven by the
// `--glow` CSS variable, which cascades from the card down to the chip.
const WAITING_GLOW_CSS = `
  @keyframes relay-pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 transparent; }
    50%      { box-shadow: 0 0 14px 2px var(--glow, transparent); }
  }
  @keyframes relay-pulse-glow-soft {
    0%, 100% { box-shadow: 0 0 0 0 transparent; }
    50%      { box-shadow: 0 0 8px 1px var(--glow, transparent); }
  }
  .relay-card-glow { animation: relay-pulse-glow      1.8s ease-in-out infinite; }
  .relay-chip-glow { animation: relay-pulse-glow-soft 1.8s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .relay-card-glow, .relay-chip-glow { animation: none; }
  }
`;

// Only super_admin is org-wide / god view. Every other supervisor-tier role
// (pod_lead, ops_manager, supervisor, admin) is identical — pod-scoped to
// their single pod_members row.
const UNSCOPED_ROLES = new Set(["super_admin"]);

// Live-tab cap. Spec is "pod-scoped, every session belonging to engineers
// on the viewer's team" — there is no artificial 10-cap. We still cap to
// keep a runaway / unscoped super_admin query bounded; 200 mirrors past.
const LIVE_LIMIT = 200;

// Resolved scope for the signed-in viewer.
//   { kind: "loading" }     — still fetching, render nothing yet
//   { kind: "unscoped" }    — super_admin / admin → no pod filter
//   { kind: "pod", podId }  — pod_lead / ops_manager → only their pod
type Scope =
  | { kind: "loading" }
  | { kind: "unscoped" }
  | { kind: "pod"; podId: string | null };

export function SuperviseClient() {
  const [sessions, setSessions] = useState<SessionWithHealth[]>([]);
  const [pastSessions, setPastSessions] = useState<SessionWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [perPage, setPerPage] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [, setTick] = useState(0);
  const [scope, setScope] = useState<Scope>({ kind: "loading" });
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Resolve the viewer's role + pod once on mount. Until this lands we hold
  // off on the data fetch — otherwise an unscoped flash would show every
  // org session for a frame before snapping back to the pod-scoped slice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabaseRef.current;
      const { data: u } = await sb.auth.getUser();
      if (cancelled || !u.user) { setScope({ kind: "pod", podId: null }); return; }
      const [rolesRes, podRes] = await Promise.all([
        sb.from("user_roles").select("role").eq("user_id", u.user.id),
        sb.from("pod_members").select("pod_id").eq("user_id", u.user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const roles = (rolesRes.data ?? []).map((r: { role: string }) => r.role);
      if (roles.some((r) => UNSCOPED_ROLES.has(r))) {
        setScope({ kind: "unscoped" });
      } else {
        const podId = (podRes.data as { pod_id?: string } | null)?.pod_id ?? null;
        setScope({ kind: "pod", podId });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refresh = async () => {
    const sb = supabaseRef.current;
    if (scope.kind === "loading") return;
    // Pod-scoped viewers with no pod assignment get an empty grid — there's
    // no organisational owner for any session yet. Skip the query entirely.
    if (scope.kind === "pod" && !scope.podId) {
      setSessions([]);
      setPastSessions([]);
      setLoading(false);
      return;
    }
    // Bug #7: pod_lead / ops_manager are restricted to sessions whose
    // pod_id matches their own pod. super_admin and admin see everything.
    // pod_id is stamped on guest_calls at claim time (claim_session RPC) —
    // see migration 20260519100000_guest_calls_pod_scope.sql.
    let liveQ = sb.from("guest_calls").select("*")
      .in("status", ACTIVE_STATES)
      .order("created_at", { ascending: false })
      .limit(LIVE_LIMIT);
    let pastQ = sb.from("guest_calls").select("*")
      .in("status", PAST_STATES)
      .order("ended_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (scope.kind === "pod" && scope.podId) {
      liveQ = liveQ.eq("pod_id", scope.podId);
      pastQ = pastQ.eq("pod_id", scope.podId);
    }
    const [liveRes, pastRes] = await Promise.all([liveQ, pastQ]);
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

  // Initial fetch runs once scope resolves. Re-runs if the viewer's pod
  // assignment changes mid-session (rare, but cheap).
  useEffect(() => { void refresh(); }, [scope]);

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
  //
  // The realtime listener fires for every guest_calls row in the org —
  // postgres_changes doesn't honour the .eq("pod_id") on the client query.
  // refresh() re-applies the pod filter, so out-of-pod events just trigger
  // a (cheap) refetch that returns nothing new.
  useEffect(() => {
    if (scope.kind === "loading") return;
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
  }, [scope]);

  const liveSessions    = useMemo(() => sessions.filter((s) => LIVE_STATES.has(s.status)),    [sessions]);
  const waitingSessions = useMemo(() => sessions.filter((s) => WAITING_STATES.has(s.status)), [sessions]);

  // Portal target for each panel's PagerStrip — lives on the right side of
  // the sticky footer. State (not ref) so children re-portal once it mounts.
  const [pagerSlot, setPagerSlot] = useState<HTMLDivElement | null>(null);

  return (
    // Flex column at full viewport height. Sticky footer (below) is in normal
    // flow inside <main>, so it respects the staff sidebar inset instead of
    // bleeding behind it the way a `position: fixed` element would. The
    // flex-1 content area pushes the legend to viewport-bottom even on an
    // empty/loading state, and `sticky bottom-0` keeps it pinned while
    // scrolling through long lists.
    <PagerSlotContext.Provider value={pagerSlot}>
    <div className="flex min-h-screen flex-col">
      <style>{WAITING_GLOW_CSS}</style>
      <div className="mx-auto w-full max-w-screen-2xl flex-1 space-y-6 px-6 pt-8 pb-6">
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

        {/* Tabs: All · Waiting · Live · Past */}
        <Tabs tab={tab} setTab={setTab} counts={{
          all:     liveSessions.length + waitingSessions.length + pastSessions.length,
          waiting: waitingSessions.length,
          live:    liveSessions.length,
          past:    pastSessions.length,
        }} />

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : (
          <TabPanel
            tab={tab}
            liveSessions={liveSessions}
            waitingSessions={waitingSessions}
            pastSessions={pastSessions}
            perPage={perPage}
            setPerPage={setPerPage}
          />
        )}
      </div>

      {/* Sticky footer — session-health legend (left) + pager slot (right).
          Stays at viewport-bottom on short pages (via parent flex-col +
          flex-1 above) and pinned during scroll on long pages. Scoped to
          <main>, so it doesn't overlap the staff sidebar. */}
      <div
        className="sticky bottom-0 z-30 border-t backdrop-blur"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "color-mix(in srgb, var(--background) 92%, transparent)",
        }}
      >
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <HealthLegend />
          {/* Right-side portal target — each panel's PagerStrip renders here */}
          <div ref={setPagerSlot} className="flex items-center" />
        </div>
      </div>
    </div>
    </PagerSlotContext.Provider>
  );
}

function HealthLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <LegendChip color={BRAND_GREEN}  label="Healthy" />
      <LegendChip color={URGENT_AMBER} label="Neutral" />
      <LegendChip color={CRIT_RED}     label="Danger" />
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  const tooltip = `Call Sentiment - ${label}`;
  return (
    <div
      className="inline-flex items-center gap-2"
      title={tooltip}
      aria-label={tooltip}
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)`,
        }}
      />
      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color }}
      >
        {label}
      </span>
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
    // Queue timeout is 90s (abandon_stale_queued_sessions). Bracket the
    // pill colors so red means "about to time out" rather than a value
    // the session can never reach.
    const waitSecs = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 1000);
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

  // Waiting sessions (queued / assigned) breathe a coloured halo so they
  // catch the supervisor's eye until they're picked up. `--glow` cascades
  // from the card to the status chip so both pulse the same colour.
  const isWaiting = WAITING_STATES.has(session.status);
  const glowVar = isWaiting
    ? ({ "--glow": tok.bar } as React.CSSProperties)
    : {};

  return (
    <div
      // Whole card is still clickable (preserves the existing "click to
      // observe" affordance) but the Join button is the explicit CTA.
      onClick={join}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); join(); } }}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.025] hover:border-[var(--text-muted)]/40 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none${isWaiting ? " relay-card-glow" : ""}`}
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
        ...glowVar,
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
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide${isWaiting ? " relay-chip-glow" : ""}`}
          style={{ backgroundColor: tok.pill_bg, color: tok.pill_fg }}
        >
          {humanState(session.status)}
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

// ── Tabs (All · Waiting · Live · Past) ─────────────────────────────────────
function Tabs({
  tab, setTab, counts,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: Record<Tab, number>;
}) {
  return (
    <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--border)" }}>
      {(["all", "waiting", "live", "past"] as const).map((t) => {
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
  tab, liveSessions, waitingSessions, pastSessions, perPage, setPerPage,
}: {
  tab: Tab;
  liveSessions: SessionWithHealth[];
  waitingSessions: SessionWithHealth[];
  pastSessions: SessionWithHealth[];
  perPage: PageSize;
  setPerPage: (n: PageSize) => void;
}) {
  if (tab === "all") {
    return (
      <AllPanel
        liveSessions={liveSessions}
        waitingSessions={waitingSessions}
        pastSessions={pastSessions}
        perPage={perPage}
        setPerPage={setPerPage}
      />
    );
  }
  if (tab === "past") {
    return (
      <PastPanel sessions={pastSessions} perPage={perPage} setPerPage={setPerPage} />
    );
  }
  return (
    <ActivePanel
      tab={tab}
      sessions={tab === "live" ? liveSessions : waitingSessions}
      perPage={perPage}
      setPerPage={setPerPage}
    />
  );
}

// ── All panel — every session in one grid: live → waiting → past ──────────
// Renders the right tile type per status so the supervisor still sees the
// live "Join session" CTA on actives and the post-completion sentiment on
// past sessions. Search filters across all three groups; sort is fixed at
// "live first, waiting second, past last, each newest-within-group" so a
// glance always surfaces what needs attention. The visible slice is then
// regrouped into Live/Waiting/Past section headers so structure is
// preserved across page boundaries.
function AllPanel({
  liveSessions, waitingSessions, pastSessions, perPage, setPerPage,
}: {
  liveSessions: SessionWithHealth[];
  waitingSessions: SessionWithHealth[];
  pastSessions: SessionWithHealth[];
  perPage: PageSize;
  setPerPage: (n: PageSize) => void;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const matchesQ = (s: SessionWithHealth, needle: string) =>
    !needle ||
    (s.guest_name   ?? "").toLowerCase().includes(needle) ||
    (s.guest_email  ?? "").toLowerCase().includes(needle) ||
    (s.agent_name   ?? "").toLowerCase().includes(needle) ||
    (s.project_name ?? "").toLowerCase().includes(needle);

  // Flat ordered list — live > waiting > past, newest-within-group — used
  // for pagination math. The grouped view below is derived from the slice.
  const ordered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byCreatedDesc = (a: SessionWithHealth, b: SessionWithHealth) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const byEndedDesc = (a: SessionWithHealth, b: SessionWithHealth) => {
      const at = a.ended_at ? new Date(a.ended_at).getTime() : 0;
      const bt = b.ended_at ? new Date(b.ended_at).getTime() : 0;
      return bt - at;
    };
    return [
      ...liveSessions   .filter((s) => matchesQ(s, needle)).sort(byCreatedDesc),
      ...waitingSessions.filter((s) => matchesQ(s, needle)).sort(byCreatedDesc),
      ...pastSessions   .filter((s) => matchesQ(s, needle)).sort(byEndedDesc),
    ];
  }, [liveSessions, waitingSessions, pastSessions, q]);

  const total = ordered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  useEffect(() => { if (page > pageCount) setPage(1); }, [page, pageCount]);
  const start = (page - 1) * perPage;
  const slice = ordered.slice(start, start + perPage);

  // Re-group the visible slice for sectioned rendering.
  const sliceLive    = slice.filter((s) => LIVE_STATES.has(s.status));
  const sliceWaiting = slice.filter((s) => WAITING_STATES.has(s.status));
  const sliceLW      = new Set([...sliceLive, ...sliceWaiting].map((s) => s.id));
  const slicePast    = slice.filter((s) => !sliceLW.has(s.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search all sessions…"
            className="rounded-md border py-1.5 pl-7 pr-2 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
              width: 260,
            }}
          />
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body={q ? `No sessions match "${q}".` : "No sessions to show."}
        />
      ) : (
        <>
          <div className="flex flex-col gap-6">
            {sliceLive.length > 0 && (
              <Section title="Live" count={sliceLive.length}>
                {sliceLive.map((s) => <SessionTile key={s.id} session={s} />)}
              </Section>
            )}
            {sliceWaiting.length > 0 && (
              <Section title="Waiting" count={sliceWaiting.length}>
                {sliceWaiting.map((s) => <SessionTile key={s.id} session={s} />)}
              </Section>
            )}
            {slicePast.length > 0 && (
              <Section title="Past" count={slicePast.length}>
                {slicePast.map((s) => <PastSessionTile key={s.id} session={s} />)}
              </Section>
            )}
          </div>
          <PagerStrip
            showingFrom={start + 1}
            showingTo={start + slice.length}
            total={total}
            page={page}
            pageCount={pageCount}
            setPage={setPage}
            perPage={perPage}
            setPerPage={setPerPage}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title, count, children,
}: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {title}
        </h2>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          ({count})
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

// ── Active (live + waiting) panel — search + sort + per-page pagination ───
function ActivePanel({
  tab, sessions, perPage, setPerPage,
}: {
  tab: "live" | "waiting";
  sessions: SessionWithHealth[];
  perPage: PageSize;
  setPerPage: (n: PageSize) => void;
}) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"recent" | "wait" | "customer" | "engineer">(
    tab === "waiting" ? "wait" : "recent",
  );
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  useEffect(() => { if (page > pageCount) setPage(1); }, [page, pageCount]);
  const start = (page - 1) * perPage;
  const slice = filtered.slice(start, start + perPage);

  return (
    <div className="flex flex-col gap-3">
      <SuperviseToolbar
        q={q} setQ={(v) => { setQ(v); setPage(1); }}
        sortKey={sortKey} setSortKey={(s) => { setSortKey(s as typeof sortKey); setPage(1); }}
        sortOptions={[
          { value: "recent",   label: "Newest first" },
          { value: "wait",     label: "Longest wait" },
          { value: "customer", label: "Customer name" },
          { value: "engineer", label: "Engineer name" },
        ]}
        searchPlaceholder={tab === "live" ? "Search live sessions…" : "Search waiting…"}
      />
      {filtered.length === 0 ? (
        tab === "live"
          ? <EmptyState title="All quiet" body={q ? `No live sessions match "${q}".` : "No active sessions right now."} />
          : <EmptyState title="Nothing waiting" body={q ? `No waiting sessions match "${q}".` : "No customers waiting to be picked up."} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {slice.map((s) => <SessionTile key={s.id} session={s} />)}
          </div>
          <PagerStrip
            showingFrom={start + 1}
            showingTo={start + slice.length}
            total={filtered.length}
            page={page}
            pageCount={pageCount}
            setPage={setPage}
            perPage={perPage}
            setPerPage={setPerPage}
          />
        </>
      )}
    </div>
  );
}

// ── Past panel — search + sort + pager (longer list) ──────────────────────
function PastPanel({
  sessions, perPage, setPerPage,
}: {
  sessions: SessionWithHealth[];
  perPage: PageSize;
  setPerPage: (n: PageSize) => void;
}) {
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
        case "sentiment": {
          // Unscored sessions go to the bottom — otherwise the `?? 0`
          // fallback would slot them at "neutral" and they'd outrank any
          // session with a negative score (which is wrong for "Best
          // sentiment" — they have no sentiment at all).
          const aScore = a.health?.score;
          const bScore = b.health?.score;
          const aHas = typeof aScore === "number" && Number.isFinite(aScore);
          const bHas = typeof bScore === "number" && Number.isFinite(bScore);
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;
          if (!aHas && !bHas) return 0;
          return (bScore as number) - (aScore as number);
        }
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
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const start = (page - 1) * perPage;
  const slice = filtered.slice(start, start + perPage);

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
            perPage={perPage}
            setPerPage={setPerPage}
          />
        </>
      )}
    </div>
  );
}

// ── Shared toolbar: search + sort ─────────────────────────────────────────
// Per-page selector and result count live with the pager at the bottom of
// the panel — see PagerStrip — so the top stays clean and the controls that
// govern pagination cluster together.
function SuperviseToolbar({
  q, setQ, sortKey, setSortKey, sortOptions, searchPlaceholder,
}: {
  q: string;
  setQ: (v: string) => void;
  sortKey: string;
  setSortKey: (k: string) => void;
  sortOptions: ReadonlyArray<{ value: string; label: string }>;
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
    </div>
  );
}

// ── Per-page dropdown ──────────────────────────────────────────────────────
function PerPageSelect({
  value, onChange,
}: {
  value: PageSize;
  onChange: (n: PageSize) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as PageSize)}
      aria-label="Items per page"
      className="rounded-md border px-2 py-1.5 text-xs outline-none"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--background)",
        color: "var(--text)",
      }}
    >
      {PAGE_SIZE_OPTIONS.map((n) => (
        <option key={n} value={n}>{n} / page</option>
      ))}
    </select>
  );
}

// ── Pager strip — portals into the sticky footer's right-hand slot ────────
// Each panel renders one of these; the content lands in the bottom-right
// of the page (next to HealthLegend) via React portal. No inline rendering,
// so the footer's design stays untouched.
function PagerStrip({
  showingFrom, showingTo, total, page, pageCount, setPage,
  perPage, setPerPage,
}: {
  showingFrom: number;
  showingTo:   number;
  total:       number;
  page:        number;
  pageCount:   number;
  setPage:     (p: number) => void;
  perPage:     PageSize;
  setPerPage:  (n: PageSize) => void;
}) {
  const slot = useContext(PagerSlotContext);
  if (!slot) return null;
  return createPortal(
    <div className="flex flex-wrap items-center gap-3">
      <PerPageSelect
        value={perPage}
        onChange={(n) => { setPerPage(n); setPage(1); }}
      />
      <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
        Showing {showingFrom}–{showingTo} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PagerBtn onClick={() => setPage(1)}        disabled={page <= 1}><ChevronsLeft  size={12} /></PagerBtn>
        <PagerBtn onClick={() => setPage(page - 1)} disabled={page <= 1}><ChevronLeft   size={12} /></PagerBtn>
        <span className="px-1 text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {page} / {pageCount}
        </span>
        <PagerBtn onClick={() => setPage(page + 1)}  disabled={page >= pageCount}><ChevronRight  size={12} /></PagerBtn>
        <PagerBtn onClick={() => setPage(pageCount)} disabled={page >= pageCount}><ChevronsRight size={12} /></PagerBtn>
      </div>
    </div>,
    slot,
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
  // Sentiment source priority (bugs2.txt #3):
  //  1. session.health   — the latest_session_health view (preferred)
  //  2. guest_calls row  — defensive copy written by summarize-guest-call
  //                        if for any reason the view doesn't surface a row.
  // Either source carries the post-end overall sentiment.
  const score =
    session.health?.score ??
    (typeof session.final_sentiment_score === "number" ? session.final_sentiment_score : undefined);
  const summaryText =
    session.health?.summary ??
    session.final_sentiment_summary ??
    null;
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
      className="group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.025] hover:border-[var(--text-muted)]/40 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none"
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
          {humanState(session.status)}
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
          {summaryText ? " — " : ""}
        </span>
        {summaryText ?? (hasScore ? "" : "no summary available")}
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
