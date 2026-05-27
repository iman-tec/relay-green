"use client";

/*
 * Supervisor live roster — "who's on" for the pod. One card per engineer with:
 *   • a live presence ball mirrored from engineer_profiles.presence_state
 *     (online=green / busy=amber / offline=grey)
 *   • an on-call pulse + customer name when the engineer is on a live session
 *   • an idle "Away · N min" when they're offline, since their last presence flip
 *
 * Read-only. Realtime on engineer_profiles (presence) + guest_calls (on-call),
 * with a 5s poll fallback and a 1s tick for the elapsed timers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Eye, Loader2, ArrowUpRight, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Card, EmptyState as UiEmptyState, cn } from "@/app/_components/ui";

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
  lastCustomer: string | null;
  lastCallAt: string | null;
  isOnline: boolean | null;
};

const PRESENCE: Record<string, { dot: string; label: string }> = {
  online:  { dot: "var(--ok)",         label: "Online" },
  busy:    { dot: "var(--warn)",       label: "Busy" },
  offline: { dot: "var(--text-faint)", label: "Offline" },
};

const ON_CALL_STATES = new Set(["assigned", "joining", "live", "grace"]);

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

  // 1s tick for elapsed timers.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime: presence flips + on-call changes. Debounced, with a 5s fallback.
  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queue = () => { if (!pending) pending = setTimeout(() => { pending = null; void refresh(); }, 600); };
    const ch = sb
      .channel("relay-roster")
      .on("postgres_changes", { event: "*", schema: "public", table: "engineer_profiles" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_calls" }, queue)
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

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>;
  }
  if (error) {
    return <Card variant="hollow" className="border-dashed"><div className="p-6"><UiEmptyState compact title="Couldn't load the roster" body={error} /></div></Card>;
  }
  if (engineers.length === 0) {
    return <Card variant="hollow" className="border-dashed"><div className="p-6"><UiEmptyState compact icon={<Users size={18} />} title="No engineers in your pod" body="Engineers assigned to your pod will appear here." /></div></Card>;
  }

  const onlineCount = engineers.filter((e) => e.presenceState === "online").length;
  const onCallCount = engineers.filter((e) => e.currentSessionId && ON_CALL_STATES.has(e.currentStatus ?? "")).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {engineers.length} engineer{engineers.length === 1 ? "" : "s"} · {onlineCount} online · {onCallCount} on a call
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {engineers.map((e) => <RosterCard key={e.userId} engineer={e} />)}
      </div>
    </div>
  );
}

function RosterCard({ engineer: e }: { engineer: Engineer }) {
  const router = useRouter();
  const onCall = !!e.currentSessionId && ON_CALL_STATES.has(e.currentStatus ?? "");
  const pres = PRESENCE[e.presenceState] ?? PRESENCE.offline;
  const watch = () => { if (e.currentSessionId) router.push(`/staff/session/${e.currentSessionId}`); };

  return (
    <Card variant="surface" className={cn("relative p-4", onCall && "relay-card-glow")}
      style={onCall ? ({ "--glow": "var(--ok)" } as React.CSSProperties) : undefined}>
      <div className="flex items-start gap-3">
        {/* Presence ball */}
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
      </div>

      <div className="mt-3 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
        {onCall ? (
          <OnCall customer={e.currentCustomer} since={e.onCallSince} />
        ) : e.presenceState === "offline" ? (
          <Away since={e.presenceSince} lastCustomer={e.lastCustomer} lastCallAt={e.lastCallAt} />
        ) : (
          <Available state={e.presenceState} lastCustomer={e.lastCustomer} lastCallAt={e.lastCallAt} />
        )}
      </div>

      {onCall && (
        <Button full size="sm" className="mt-3" onClick={watch}
          iconLeft={<Eye size={14} />} iconRight={<ArrowUpRight size={12} className="opacity-80" />}>
          Watch session
        </Button>
      )}
    </Card>
  );
}

function OnCall({ customer, since }: { customer: string | null; since: string | null }) {
  const elapsed = since ? fmtSince(since) : null;
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex size-1.5 animate-pulse rounded-full" style={{ backgroundColor: "var(--ok)" }} />
      <span style={{ color: "var(--text)" }}>
        On call{customer ? <> · <span className="font-medium">{customer}</span></> : ""}
      </span>
      {elapsed && <span className="ml-auto tabular-nums" style={{ color: "var(--text-muted)" }}>{elapsed}</span>}
    </div>
  );
}

function Away({ since, lastCustomer, lastCallAt }: { since: string | null; lastCustomer: string | null; lastCallAt: string | null }) {
  const away = since ? fmtSince(since) : null;
  return (
    <div className="flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
      <span>Away{away ? ` · ${away}` : ""}</span>
      {lastCustomer && lastCallAt && (
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          Last: {lastCustomer} · {new Date(lastCallAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}

function Available({ state, lastCustomer, lastCallAt }: { state: string; lastCustomer: string | null; lastCallAt: string | null }) {
  return (
    <div className="flex flex-col gap-1" style={{ color: "var(--text-muted)" }}>
      <span>{state === "busy" ? "Busy — not taking calls" : "Available"}</span>
      {lastCustomer && lastCallAt && (
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          Last: {lastCustomer} · {new Date(lastCallAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}

// "12 min", "1h 4m", "0:42" style elapsed since an ISO timestamp.
function fmtSince(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}
