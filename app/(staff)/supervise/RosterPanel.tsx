"use client";

/*
 * Supervisor live roster — ONE card per engineer (the atomic unit). Collapsed,
 * each card shows everything about an engineer without a click:
 *   • presence ball (online/busy/offline) mirrored from engineer_profiles
 *   • live client context (customer + duration) when on a call, or "Away · N min"
 *   • a compact KPI strip (live-now / build-minutes 30d / sessions 30d)
 *   • a live sentiment chip from latest_session_health when on a call
 * Clicking expands the card in place into a read-only drill-in (30d totals +
 * recent sessions). Realtime on engineer_profiles + guest_calls + session_health.
 *
 * Note: per-engineer go-live/maintain counts aren't shown here — there is no
 * projects.contract_type signal in the schema; that engagement split lives on
 * the Job-3 estimation surface (project_quote_requests.kind), not the roster.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Eye, Loader2, ArrowUpRight, Users, ChevronDown, Activity, Timer, Hash, Flag, X, TrendingUp, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Card, EmptyState as UiEmptyState, cn } from "@/app/_components/ui";
import { eur } from "@/app/(staff)/enterprise/v2/_shared";

type Sentiment = { score: number; summary: string; messageCount: number };
type Engineer = {
  userId: string;
  displayName: string;
  email: string;
  presenceState: "online" | "busy" | "offline" | string;
  presenceSince: string | null;
  currentCustomer: string | null;
  currentSessionId: string | null;
  currentStatus: string | null;
  onCallSince: string | null;
  buildMinutes: number;
  sessions30d: number;
  liveSentiment: Sentiment | null;
  lastCustomer: string | null;
  lastCallAt: string | null;
};

const PRESENCE: Record<string, { dot: string; label: string }> = {
  online:  { dot: "var(--ok)",         label: "Online" },
  busy:    { dot: "var(--warn)",       label: "Busy" },
  offline: { dot: "var(--text-faint)", label: "Offline" },
};
const ON_CALL_STATES = new Set(["assigned", "joining", "live", "grace"]);
const MIN_MESSAGES_FOR_AI = 2;

export function RosterPanel() {
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/team", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { engineers?: Engineer[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't load the team.");
      setEngineers(body.engineers ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the team.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);

  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queue = () => { if (!pending) pending = setTimeout(() => { pending = null; void refresh(); }, 600); };
    const ch = sb
      .channel("relay-roster")
      .on("postgres_changes", { event: "*", schema: "public", table: "engineer_profiles" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_calls" }, queue)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_health" }, queue)
      .subscribe();
    channelRef.current = ch;
    const fallback = setInterval(() => { void refresh(); }, 5_000);
    return () => {
      if (pending) clearTimeout(pending);
      sb.removeChannel(ch);
      channelRef.current = null;
      clearInterval(fallback);
    };
  }, [refresh]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>;
  if (error) return <Card variant="hollow" className="border-dashed"><div className="p-6"><UiEmptyState compact title="Couldn't load the roster" body={error} /></div></Card>;
  if (engineers.length === 0) return <Card variant="hollow" className="border-dashed"><div className="p-6"><UiEmptyState compact icon={<Users size={18} />} title="No engineers in your pod" body="Engineers assigned to your pod will appear here." /></div></Card>;

  const onlineCount = engineers.filter((e) => e.presenceState === "online").length;
  const onCallCount = engineers.filter((e) => e.currentSessionId && ON_CALL_STATES.has(e.currentStatus ?? "")).length;
  // Pod aggregate KPIs (E1), summed across the pod's engineers.
  const buildMinutes = engineers.reduce((s, e) => s + (e.buildMinutes || 0), 0);
  const sessions30d = engineers.reduce((s, e) => s + (e.sessions30d || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Pod dashboard — KPIs across the whole pod */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Kpi label="Engineers" value={fmtNum(engineers.length)} />
        <Kpi label="Online" value={fmtNum(onlineCount)} />
        <Kpi label="Live now" value={fmtNum(onCallCount)} />
        <Kpi label="Build min" value={fmtNum(buildMinutes)} sub="30d" />
        <Kpi label="Sessions" value={fmtNum(sessions30d)} sub="30d" />
      </div>

      <ThemesCard />
      <PayoutsCard />
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {engineers.map((e) => <EngineerCard key={e.userId} engineer={e} />)}
      </div>
    </div>
  );
}

// ── D5 — recurring escalation themes (LLM, behind graceful states) ─────────
function ThemesCard() {
  const [state, setState] = useState<"loading" | "ok" | "insufficient" | "unavailable">("loading");
  const [themes, setThemes] = useState<{ theme: string; count: number }[]>([]);
  const [sample, setSample] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/supervisor/escalation-themes", { cache: "no-store" });
        const j = (await res.json().catch(() => ({}))) as { state?: string; themes?: { theme: string; count: number }[]; sampleSize?: number };
        if (!alive) return;
        setThemes(j.themes ?? []); setSample(j.sampleSize ?? 0);
        setState((j.state as "ok" | "insufficient" | "unavailable") ?? "unavailable");
      } catch { if (alive) setState("unavailable"); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
        <TrendingUp size={15} /> Recurring escalation themes
      </div>
      {state === "loading" ? (
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Computing…</div>
      ) : state === "ok" && themes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {themes.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              {t.theme}<span className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums" style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}>{t.count}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {state === "insufficient" ? `Not enough escalations yet to surface themes (${sample} in 30d).` :
           state === "ok" ? "No recurring themes — escalations look one-off." :
           "Theme detection unavailable right now."}
        </p>
      )}
    </div>
  );
}

// ── E3 — pod payouts overview ──────────────────────────────────────────────
type Payouts = { total: { earningsCents: number; billableMinutes: number; sessions: number }; engineers: { name: string; earningsCents: number; billableMinutes: number; sessions: number; lastSessionAt: string | null }[] };

function PayoutsCard() {
  const [data, setData] = useState<Payouts | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/supervisor/payouts", { cache: "no-store" });
        if (res.ok && alive) setData((await res.json()) as Payouts);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);
  if (!data || data.engineers.length === 0) return null;

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        <Wallet size={15} style={{ color: "var(--text-muted)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Pod payouts</span>
        <span className="text-sm tabular-nums" style={{ color: "var(--text)" }}>{eur(data.total.earningsCents)}</span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>· {fmtNum(data.total.billableMinutes)} billable min · {fmtNum(data.total.sessions)} sessions</span>
        <ChevronDown size={15} className={cn("ml-auto transition-transform", open && "rotate-180")} style={{ color: "var(--text-muted)" }} />
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {data.engineers.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{e.name}</span>
              <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtNum(e.billableMinutes)}m · {fmtNum(e.sessions)}</span>
              <span className="w-20 shrink-0 text-right font-medium tabular-nums" style={{ color: "var(--text)" }}>{eur(e.earningsCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The atomic roster unit ────────────────────────────────────────────────
type Detail = {
  engineer: { totals: { sessions30d: number; buildMinutes: number; avgDurationMin: number }; escalations30d: number; escalationRate: number };
  recentSessions: Array<{ id: string; guestName: string | null; status: string; durationMinutes: number | null; createdAt: string; endedAt: string | null; projectName: string | null }>;
  escalations: Array<{ id: string; reason: string; note: string | null; status: string; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }>;
};

function EngineerCard({ engineer: e }: { engineer: Engineer }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const onCall = !!e.currentSessionId && ON_CALL_STATES.has(e.currentStatus ?? "");
  const pres = PRESENCE[e.presenceState] ?? PRESENCE.offline;
  const watch = () => { if (e.currentSessionId) router.push(`/staff/session/${e.currentSessionId}`); };

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && !detailLoading) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/supervisor/engineer/${e.userId}`, { cache: "no-store" });
        if (res.ok) setDetail((await res.json()) as Detail);
      } finally { setDetailLoading(false); }
    }
  };

  return (
    <Card variant="surface" className={cn("relative p-4", onCall && "relay-card-glow", expanded && "2xl:col-span-2")}
      style={onCall ? ({ "--glow": "var(--ok)" } as React.CSSProperties) : undefined}>
      <button type="button" onClick={() => void toggle()} className="flex w-full items-start gap-3 text-left" aria-expanded={expanded}>
        <span className="relative mt-1 inline-flex size-3 shrink-0">
          {e.presenceState === "online" && (
            <span aria-hidden className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ backgroundColor: pres.dot }} />
          )}
          <span className="relative inline-flex size-3 rounded-full" style={{ backgroundColor: pres.dot }} title={pres.label} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>{e.displayName}</div>
          <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{e.email}</div>
        </div>
        <ChevronDown size={15} className={cn("mt-1 shrink-0 transition-transform", expanded && "rotate-180")} style={{ color: "var(--text-muted)" }} />
      </button>

      {/* Live context / idle */}
      <div className="mt-3 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
        {onCall ? <OnCall customer={e.currentCustomer} since={e.onCallSince} />
          : e.presenceState === "offline" ? <Away since={e.presenceSince} lastCustomer={e.lastCustomer} lastCallAt={e.lastCallAt} />
          : <Available state={e.presenceState} lastCustomer={e.lastCustomer} lastCallAt={e.lastCallAt} />}
      </div>

      {/* Live sentiment chip (only meaningful on a call) */}
      {onCall && <SentimentChip s={e.liveSentiment} />}

      {/* KPI strip */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Kpi icon={<Activity size={12} />} label="Live now" value={onCall ? "1" : "0"} />
        <Kpi icon={<Timer size={12} />} label="Build min" value={fmtNum(e.buildMinutes)} sub="30d" />
        <Kpi icon={<Hash size={12} />} label="Sessions" value={fmtNum(e.sessions30d)} sub="30d" />
      </div>

      {onCall && (
        <Button full size="sm" className="mt-3" onClick={watch} iconLeft={<Eye size={14} />} iconRight={<ArrowUpRight size={12} className="opacity-80" />}>
          Watch session
        </Button>
      )}

      {/* Flag a leave/availability issue up to super-admin (relay). */}
      <FlagAvailability userId={e.userId} name={e.displayName} />

      {/* Expand-in-place drill-in */}
      {expanded && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          {detailLoading && !detail ? (
            <div className="flex items-center gap-2 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : detail ? (
            <DrillIn detail={detail} />
          ) : (
            <p className="py-4 text-xs" style={{ color: "var(--text-muted)" }}>Couldn&apos;t load detail.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function DrillIn({ detail }: { detail: Detail }) {
  const router = useRouter();
  const t = detail.engineer.totals;
  const rate = detail.engineer.escalationRate;
  const rateTone = rate >= 3 ? "var(--risk)" : rate >= 1.5 ? "var(--warn)" : "var(--text)";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2">
        <Kpi label="Sessions" value={fmtNum(t.sessions30d)} sub="30d" />
        <Kpi label="Build min" value={fmtNum(t.buildMinutes)} sub="30d" />
        <Kpi label="Avg" value={`${fmtNum(t.avgDurationMin)}m`} sub="per call" />
        {/* D4 — escalations per 10 sessions */}
        <div className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Esc rate</div>
          <div className="text-sm font-semibold tabular-nums" style={{ color: rateTone }}>
            {rate}<span className="ml-0.5 text-[10px] font-normal" style={{ color: "var(--text-faint)" }}>/10</span>
          </div>
        </div>
      </div>

      {/* D3 — escalation history */}
      {detail.escalations.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Escalations ({detail.engineer.escalations30d} in 30d)
          </h4>
          <ul className="flex flex-col gap-1.5">
            {detail.escalations.map((e) => (
              <li key={e.id} className="rounded-md border px-2.5 py-1.5 text-xs" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--text)" }}>{e.reason}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                    style={{ color: e.status === "open" ? "var(--warn)" : e.status === "resolved" ? "var(--ok)" : "var(--text-muted)", background: "color-mix(in srgb, var(--text) 6%, transparent)" }}>{e.status}</span>
                  <span className="shrink-0" style={{ color: "var(--text-faint)" }}>{new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
                {e.resolutionNote && <div className="mt-0.5 truncate" style={{ color: "var(--text-faint)" }}>↳ {e.resolutionNote}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Recent sessions</h4>
        {detail.recentSessions.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>No sessions yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.recentSessions.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => router.push(`/staff/session/${s.id}`)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                  <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>
                    {s.guestName || "Customer"}{s.projectName ? <span style={{ color: "var(--text-faint)" }}> · {s.projectName}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {s.durationMinutes != null ? `${s.durationMinutes}m` : "—"}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--text-faint)" }}>
                    {new Date(s.endedAt ?? s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Supervisor flags a leave/availability issue → routes up to super-admin.
function FlagAvailability({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("availability");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const { error } = await createClient().rpc("raise_availability_request", { _engineer_user_id: userId, _kind: kind, _detail: detail.trim() || null });
      if (error) throw new Error(error.message);
      setDone(true);
      setTimeout(() => { setOpen(false); setDone(false); setDetail(""); }, 1300);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't flag."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        <Flag size={11} /> Flag to super-admin
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" style={{ backgroundColor: "var(--scrim)" }} onClick={() => !busy && setOpen(false)} />
          <div role="dialog" aria-modal="true" className="fixed left-1/2 top-1/2 z-[61] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
            <div className="mb-3 flex items-center gap-2">
              <Flag size={15} style={{ color: "var(--primary-hover)" }} />
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Flag {name}</h2>
              <button type="button" onClick={() => !busy && setOpen(false)} className="ml-auto" style={{ color: "var(--text-muted)" }}><X size={16} /></button>
            </div>
            {done ? (
              <p className="py-4 text-center text-sm" style={{ color: "var(--ok)" }}>Routed to super-admin.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Supervisors monitor availability; super-admin owns leave. This routes up for action.</p>
                <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                  Type
                  <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 rounded-lg border px-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}>
                    <option value="availability">Availability issue</option>
                    <option value="leave">Leave request</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} placeholder="What's the issue?"
                  className="rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
                {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => !busy && setOpen(false)} disabled={busy} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>Cancel</button>
                  <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Flag size={13} />} Flag
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function SentimentChip({ s }: { s: Sentiment | null }) {
  // Below the message threshold the LLM has nothing to read — degrade.
  if (!s || s.messageCount < MIN_MESSAGES_FOR_AI) {
    return (
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        <span className="inline-flex size-1.5 rounded-full" style={{ backgroundColor: "var(--text-faint)" }} /> Sentiment · no signal yet
      </div>
    );
  }
  const tone = s.score >= 0.3 ? "var(--ok)" : s.score > -0.3 ? "var(--warn)" : "var(--risk)";
  const label = s.score >= 0.3 ? "Positive" : s.score > -0.3 ? "Neutral" : "Negative";
  return (
    <div className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
      style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 10%, transparent)`, color: tone }}
      title={s.summary}>
      <span className="inline-flex size-1.5 rounded-full" style={{ backgroundColor: tone }} />
      <span className="font-medium">{label}</span>
      <span className="truncate opacity-80">· {s.summary}</span>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon?: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {icon}{label}
      </div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: "var(--text)" }}>
        {value}{sub ? <span className="ml-0.5 text-[10px] font-normal" style={{ color: "var(--text-faint)" }}>{sub}</span> : null}
      </div>
    </div>
  );
}

function OnCall({ customer, since }: { customer: string | null; since: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex size-1.5 animate-pulse rounded-full" style={{ backgroundColor: "var(--ok)" }} />
      <span style={{ color: "var(--text)" }}>On call{customer ? <> · <span className="font-medium">{customer}</span></> : ""}</span>
      {since && <span className="ml-auto tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtSince(since)}</span>}
    </div>
  );
}
function Away({ since, lastCustomer, lastCallAt }: { since: string | null; lastCustomer: string | null; lastCallAt: string | null }) {
  return (
    <div className="flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
      <span>Away{since ? ` · ${fmtSince(since)}` : ""}</span>
      {lastCustomer && lastCallAt && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Last: {lastCustomer} · {new Date(lastCallAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
    </div>
  );
}
function Available({ state, lastCustomer, lastCallAt }: { state: string; lastCustomer: string | null; lastCallAt: string | null }) {
  return (
    <div className="flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
      <span>{state === "busy" ? "Busy — not taking calls" : "Available"}</span>
      {lastCustomer && lastCallAt && <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Last: {lastCustomer} · {new Date(lastCallAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
    </div>
  );
}

function fmtNum(n: number): string { return new Intl.NumberFormat("en-US").format(Math.round(n || 0)); }
function fmtSince(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
