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
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Activity, AlertTriangle, Clock, Eye, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#c66645";
const URGENT_AMBER_SOFT = "rgba(198, 102, 69, 0.14)";
const CRIT_RED = "#c8553d";
const CRIT_RED_SOFT = "rgba(200, 85, 61, 0.18)";

const ACTIVE_STATES = ["queued", "assigned", "joining", "live", "grace"];

export function SuperviseClient() {
  const [sessions, setSessions] = useState<GuestCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    const sb = supabaseRef.current;
    const { data } = await sb.from("guest_calls").select("*")
      .in("status", ACTIVE_STATES)
      .order("created_at", { ascending: false })
      .limit(100);
    setSessions((data as GuestCall[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  // Tick every second so wait timers update live
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime
  useEffect(() => {
    const sb = supabaseRef.current;
    const ch = sb
      .channel("relay-supervise")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "guest_calls" },
        () => { void refresh(); })
      .subscribe();
    channelRef.current = ch;
    return () => { sb.removeChannel(ch); channelRef.current = null; };
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
          Every active session, live. Click a tile to observe.
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

function SessionTile({ session }: { session: GuestCall }) {
  const u = session.urgency;
  const accent = u === "critical" ? { bg: CRIT_RED_SOFT, fg: CRIT_RED }
    : u === "urgent" ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN };

  const elapsed = session.joined_at
    ? Math.floor((Date.now() - new Date(session.joined_at).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000);

  return (
    <Link
      href={`/staff/session/${session.id}`}
      className="block rounded-xl border p-4 transition-colors hover:border-[#3f5c2e]/50"
      style={{ borderColor: u === "normal" ? "var(--border)" : accent.fg + "55", backgroundColor: "var(--surface)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: accent.bg, color: accent.fg }}>
          {session.status}
        </span>
        {u !== "normal" && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: accent.bg, color: accent.fg }}>
            <AlertTriangle size={10} /> {u}
          </span>
        )}
      </div>

      <div className="mb-3">
        <div className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {session.guest_name}
        </div>
        <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {session.guest_email}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
        <Stat label={session.status === "live" ? "Live for" : "Waiting"} value={fmtSecs(elapsed)} />
        <Stat label="Recalls" value={String(session.recall_count)} />
        <Stat label="Engineer" value={session.agent_name ?? "—"} />
        <Stat label="Eye" value={<Eye size={11} className="inline" />} />
      </div>
    </Link>
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
