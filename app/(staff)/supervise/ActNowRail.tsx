"use client";

/*
 * Left-rail "act now" queue — the supervisor's front door to urgent work.
 *   1. Estimation requests (go-live / maintain) — pinned top, the Job-3 trigger.
 *   2. Callback queue — customers waiting on a Busy/Offline engineer, with age
 *      and an SLA-breach (>30 min) flag.
 *
 * Read feed (acting on an estimation request → dive-in/proposal lands in a
 * later step). Realtime on project_quote_requests + engineer_connect_requests,
 * 5s poll fallback, 1s tick for ages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Loader2, Rocket, Wrench, PhoneCall, AlertTriangle, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Estimation = { id: string; kind: "golive" | "maintain" | string; customer: string; project: string; projectId: string; comments: string | null; createdAt: string };
type Callback = { id: string; customer: string; engineer: string; project: string | null; message: string | null; createdAt: string; slaBreached: boolean };
type Feed = { estimationRequests: Estimation[]; callbackQueue: Callback[] };

export function ActNowRail() {
  const [feed, setFeed] = useState<Feed>({ estimationRequests: [], callbackQueue: [] });
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/act-now", { cache: "no-store" });
      if (res.ok) setFeed((await res.json()) as Feed);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queue = () => { if (!pending) pending = setTimeout(() => { pending = null; void refresh(); }, 600); };
    const ch = sb
      .channel("relay-act-now")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_quote_requests" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "engineer_connect_requests" }, queue)
      .subscribe();
    channelRef.current = ch;
    const fallback = setInterval(() => { void refresh(); }, 5_000);
    return () => { if (pending) clearTimeout(pending); sb.removeChannel(ch); channelRef.current = null; clearInterval(fallback); };
  }, [refresh]);

  const breaches = feed.callbackQueue.filter((c) => c.slaBreached).length;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Act now</h2>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>
      ) : (
        <>
          {/* Estimation requests — pinned top, loud */}
          <Section title="Estimation requests" count={feed.estimationRequests.length} accent="var(--primary)">
            {feed.estimationRequests.length === 0 ? (
              <Empty body="No go-live or maintenance estimates waiting." />
            ) : feed.estimationRequests.map((q) => <EstimationRow key={q.id} q={q} />)}
          </Section>

          {/* Callback queue */}
          <Section title="Callback queue" count={feed.callbackQueue.length}
            accent={breaches > 0 ? "var(--risk)" : "var(--warn)"}
            badge={breaches > 0 ? `${breaches} SLA` : undefined}>
            {feed.callbackQueue.length === 0 ? (
              <Empty body="No customers waiting on an engineer." />
            ) : feed.callbackQueue.map((c) => <CallbackRow key={c.id} c={c} />)}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, count, accent, badge, children }: { title: string; count: number; accent: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-1.5 rounded-full" style={{ backgroundColor: accent }} />
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{count}</span>
        {badge && (
          <span className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: "color-mix(in srgb, var(--risk) 14%, transparent)", color: "var(--risk)" }}>{badge}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function EstimationRow({ q }: { q: Estimation }) {
  const golive = q.kind === "golive";
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 7%, transparent)" }}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--primary-hover)" }}>
        {golive ? <Rocket size={12} /> : <Wrench size={12} />}
        {golive ? "Go-live" : "Maintain"}
        <span className="ml-auto font-normal normal-case" style={{ color: "var(--text-muted)" }}>{fmtAgo(q.createdAt)}</span>
      </div>
      <div className="mt-1.5 truncate text-sm font-medium" style={{ color: "var(--text)" }}>{q.project}</div>
      <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{q.customer}</div>
      {q.comments && <p className="mt-1.5 line-clamp-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{q.comments}</p>}
    </div>
  );
}

function CallbackRow({ c }: { c: Callback }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: c.slaBreached ? "var(--risk)" : "var(--border)", background: c.slaBreached ? "color-mix(in srgb, var(--risk) 8%, transparent)" : "var(--surface)" }}>
      <div className="flex items-center gap-1.5 text-xs">
        <PhoneCall size={12} style={{ color: c.slaBreached ? "var(--risk)" : "var(--warn)" }} />
        <span className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--text)" }}>{c.customer}</span>
        <span className="shrink-0 tabular-nums" style={{ color: c.slaBreached ? "var(--risk)" : "var(--text-muted)" }}>{fmtAgo(c.createdAt)}</span>
      </div>
      <div className="mt-1 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
        waiting on <span style={{ color: "var(--text)" }}>{c.engineer}</span>{c.project ? ` · ${c.project}` : ""}
      </div>
      {c.slaBreached && (
        <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase" style={{ color: "var(--risk)" }}>
          <AlertTriangle size={10} /> SLA breached
        </div>
      )}
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
      <Inbox size={13} /> {body}
    </div>
  );
}

function fmtAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}
