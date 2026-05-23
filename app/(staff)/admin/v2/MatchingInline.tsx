"use client";

/*
 * Matching — global live view of every offer currently being rung
 * across every pod. Rendered as the main-area content of the
 * InternalUsersTab when the "Matching" sidebar tile is selected.
 *
 * Table chrome (header row + section frame) is always visible — even
 * with zero offers — so the structure is on display while the platform
 * is idle. The empty case shows a single placeholder row spanning all
 * columns so the layout doesn't collapse.
 *
 * Realtime via engineer_match_offers postgres_changes + 5s polling
 * fallback; a 1-second tick keeps the countdown column moving without
 * re-querying.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Search, Loader2 } from "lucide-react";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { createClient } from "@/lib/supabase/browser";
import { MatchingActions } from "@/app/_components/MatchingActions";
import type { AdminMatchingRow } from "@/app/api/admin/matching/route";

const URGENT_AMBER = "#d4a017";
const CRIT_RED     = "#c2410c";
const COUNTDOWN_URGENT_S = 30;
const COUNTDOWN_CRIT_S   = 10;

const COL_COUNT = 9; // Customer · Engineer · Pod · Score · Ring · Declined · Queued · Stack · Override

export function MatchingInline() {
  const [rows, setRows] = useState<AdminMatchingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // `now` in state (not Date.now() in render) keeps the countdown pure; the
  // 1s tick below advances it. Mirrors app/intake/matching/[id]/MatchingClient.
  const [now, setNow] = useState(() => Date.now());
  const supabaseRef = useRef(createClient());
  const channelRef  = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/admin/matching", { cache: "no-store" });
      const body = await res.json().catch(() => ({ rows: [] }));
      setRows((body.rows ?? []) as AdminMatchingRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; void refresh(); }, 400);
    };
    const ch = sb
      .channel("relay-admin-matching")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "engineer_match_offers" },
        queueRefresh)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "client_intakes" },
        queueRefresh)
      .subscribe();
    channelRef.current = ch;
    const fallback = setInterval(() => { void refresh(); }, 5_000);
    return () => {
      if (pending) clearTimeout(pending);
      sb.removeChannel(ch);
      channelRef.current = null;
      clearInterval(fallback);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.engineer.displayName.toLowerCase().includes(q) ||
      r.engineer.email.toLowerCase().includes(q) ||
      r.customer.displayName.toLowerCase().includes(q) ||
      (r.projectName ?? "").toLowerCase().includes(q) ||
      (r.pod?.name ?? "").toLowerCase().includes(q) ||
      r.technologies.some((t) => t.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <>
      <Breadcrumb items={[{ label: "Matching" }] satisfies Crumb[]} />

      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Every customer right now whose call is being matched to an engineer.
        Updates live as offers ring, decline, accept, or expire.
      </p>

      <section
        className="overflow-hidden rounded-lg border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <header
          className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="relative max-w-xs flex-1">
            <Search
              className="pointer-events-none absolute top-2 left-2 size-4"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer, engineer, pod, or stack…"
              className="w-full rounded-md border bg-transparent py-1.5 pr-2 pl-7 text-xs outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {loading ? "Loading…" : `${visible.length} of ${rows.length}`}
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-[11px] tracking-wider uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                <Th>Customer · project</Th>
                <Th>Engineer being rung</Th>
                <Th>Pod</Th>
                <Th>Score</Th>
                <Th>Ring left</Th>
                <Th>Declined</Th>
                <Th>Queued for</Th>
                <Th>Stack</Th>
                <Th>Override</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <EmptyRow>
                  <Loader2 size={14} className="inline animate-spin" style={{ color: "var(--primary)" }} />
                </EmptyRow>
              ) : visible.length === 0 ? (
                <EmptyRow>
                  {rows.length === 0
                    ? "Nobody is being matched right now. New offers appear here automatically."
                    : query
                      ? `No matches for “${query}”.`
                      : "No live matching."}
                </EmptyRow>
              ) : (
                visible.map((r) => <Row key={r.offerId} row={r} now={now} onChanged={() => void refresh()} />)
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td
        colSpan={COL_COUNT}
        className="px-4 py-10 text-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {children}
      </td>
    </tr>
  );
}

function Row({ row, now, onChanged }: { row: AdminMatchingRow; now: number; onChanged: () => void }) {
  const ringMs = new Date(row.expiresAt).getTime() - now;
  const ringS  = Math.max(0, Math.ceil(ringMs / 1000));
  const queuedMs = row.queuedAt ? now - new Date(row.queuedAt).getTime() : 0;

  let ringColor = "var(--text)";
  if (ringS <= COUNTDOWN_CRIT_S)        ringColor = CRIT_RED;
  else if (ringS <= COUNTDOWN_URGENT_S) ringColor = URGENT_AMBER;

  return (
    <tr
      className="border-t"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    >
      <Td>
        <div className="font-medium">{row.customer.displayName}</div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {row.projectName ?? row.developing ?? "—"}
        </div>
      </Td>
      <Td>
        <div className="font-medium">{row.engineer.displayName}</div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {row.engineer.email}
          {row.engineer.experienceLevel ? ` · ${row.engineer.experienceLevel}` : ""}
        </div>
      </Td>
      <Td>
        {row.pod ? (
          <span
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px]"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
              color: "var(--text)",
            }}
          >
            {row.pod.name}
          </span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </Td>
      <Td>
        <span className="tabular-nums">{row.matchScore.toFixed(1)}</span>
      </Td>
      <Td>
        <span className="tabular-nums font-medium" style={{ color: ringColor }}>
          {ringS}s
        </span>
      </Td>
      <Td>
        {row.declinedBy.length === 0 ? (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ) : (
          <span
            title={row.declinedBy.map((d) => d.displayName).join(", ")}
            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px]"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
              color: "var(--text)",
            }}
          >
            {row.declinedBy.length}
          </span>
        )}
      </Td>
      <Td>
        <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
          {formatDuration(queuedMs)}
        </span>
      </Td>
      <Td>
        {row.technologies.length === 0 ? (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.technologies.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-md px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
                  color: "var(--text)",
                }}
              >
                {t}
              </span>
            ))}
            {row.technologies.length > 3 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                +{row.technologies.length - 3}
              </span>
            )}
          </div>
        )}
      </Td>
      <Td>
        <MatchingActions intakeId={row.intakeId} onChanged={onChanged} />
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-top">{children}</td>;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
