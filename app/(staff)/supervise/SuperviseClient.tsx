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
import { Activity, AlertTriangle, Clock, Eye, Loader2, ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#c66645";
const URGENT_AMBER_SOFT = "rgba(198, 102, 69, 0.14)";
const CRIT_RED = "#c8553d";
const CRIT_RED_SOFT = "rgba(200, 85, 61, 0.18)";

const ACTIVE_STATES = ["queued", "assigned", "joining", "live", "grace"];

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

export function SuperviseClient() {
  const [sessions, setSessions] = useState<SessionWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
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
    const { data } = await sb.from("guest_calls").select("*")
      .in("status", ACTIVE_STATES)
      .order("created_at", { ascending: false })
      .limit(100);
    const rows = (data as GuestCall[]) ?? [];

    // Pull the latest AI health snapshot for each visible session in
    // one round-trip. Missing rows just mean "not scored yet" — the
    // card falls back to deterministic colour via deriveHealth.
    let healthMap = new Map<string, HealthSnapshot>();
    if (rows.length > 0) {
      const { data: healths } = await sb
        .from("latest_session_health")
        .select("session_id, score, summary, computed_at, message_count")
        .in("session_id", rows.map((s) => s.id));
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
  useEffect(() => {
    const sb = supabaseRef.current;
    const ch = sb
      .channel("relay-supervise")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "session_health" },
        () => { void refresh(); })
      .subscribe();
    channelRef.current = ch;
    const fallback = setInterval(() => { void refresh(); }, 30_000);
    return () => {
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric icon={Activity} label="Active sessions" value={metrics.active} accent={BRAND_GREEN} bg={BRAND_GREEN_SOFT} />
        <Metric icon={Activity} label="Live now"        value={metrics.live}   accent={BRAND_GREEN} bg={BRAND_GREEN_SOFT} />
        <Metric icon={AlertTriangle} label="Urgent"     value={metrics.urgent} accent={URGENT_AMBER} bg={URGENT_AMBER_SOFT} />
        <Metric icon={Clock} label="Avg wait"           value={fmtSecs(metrics.avgWait)} accent="#0284c7" bg="rgba(2, 132, 199, 0.12)" />
        <Metric icon={Clock} label="Longest wait"       value={fmtSecs(metrics.longestWait)} accent="#7c3aed" bg="rgba(124, 58, 237, 0.12)" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="rounded-xl border border-dashed px-6 py-16 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>All quiet</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            No active sessions in your org. New activity appears here in real time.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sessions.map((s) => <SessionTile key={s.id} session={s} />)}
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

function fmtSecs(s: number) {
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
