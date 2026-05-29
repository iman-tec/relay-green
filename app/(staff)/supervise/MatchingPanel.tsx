"use client";

/*
 * Live matching board — every offer currently being rung TO AN ENGINEER
 * IN THE CALLER'S POD. Supervisor-scoped: shows only the pod's ring
 * traffic. A global super_admin variant will be added later.
 *
 * Data flow:
 *   - Initial + on-change fetch via /api/supervisor/matching (service-role
 *     join with pod scoping enforced server-side)
 *   - Realtime: subscribe to engineer_match_offers postgres_changes; any
 *     event pokes the API again (debounced 400ms). RLS narrows delivery
 *     to offers in the supervisor's pod — see
 *     supabase/migrations/20260522110808_super_admin_read_match_offers.sql
 *   - 1s tick keeps the countdown column moving without re-querying
 *   - 5s poll fallback for the rare realtime drop
 *
 * Empty state ("no matching right now") is meaningful — it tells the
 * supervisor the pod is idle, not that something is hidden.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Loader2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { MatchingActions } from "@/app/_components/MatchingActions";
import type { MatchingRow } from "@/app/api/supervisor/matching/route";

const BRAND_GREEN = "#3f5c2e";
const URGENT_AMBER = "#d4a017";
const CRIT_RED    = "#c2410c";

const COUNTDOWN_URGENT_S = 12; // amber threshold (25s ring)
const COUNTDOWN_CRIT_S   = 5;  // red threshold

export function MatchingPanel({
  // Pod supervisors hit the pod-scoped endpoint; super_admin passes the global
  // /api/admin/matching endpoint to see every ring platform-wide. Both return
  // the same row shape.
  endpoint = "/api/supervisor/matching",
  scope = "pod",
}: { endpoint?: string; scope?: "pod" | "global" } = {}) {
  const isGlobal = scope === "global";
  const [rows, setRows] = useState<MatchingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // `now` in state (not Date.now() in render) keeps the countdown pure; the
  // 1s tick below advances it. Mirrors app/intake/matching/[id]/MatchingClient.
  const [now, setNow] = useState(() => Date.now());
  const supabaseRef = useRef(createClient());
  const channelRef  = useRef<RealtimeChannel | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const body = await res.json().catch(() => ({ rows: [] }));
      setRows((body.rows ?? []) as MatchingRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  // Realtime — every offer change pokes a debounced refresh. RLS gates
  // delivery; the super_admin policy added in 20260522110808 lets these
  // events land for this audience.
  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; void refresh(); }, 400);
    };
    const ch = sb
      .channel("relay-matching")
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

  // 1s tick — keeps the countdown + queued-for columns ticking even when
  // no DB events fire.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.engineer.displayName.toLowerCase().includes(q) ||
      r.engineer.email.toLowerCase().includes(q) ||
      r.customer.displayName.toLowerCase().includes(q) ||
      (r.projectName ?? "").toLowerCase().includes(q) ||
      r.technologies.some((t) => t.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {rows.length === 0
            ? (isGlobal ? "No one is being matched right now." : "No one in your pod is being matched right now.")
            : `${rows.length} engineer${rows.length === 1 ? "" : "s"} ${isGlobal ? "" : "in your pod "}being rung. Updates live.`}
        </p>
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, engineer, or stack…"
            className="rounded-md border py-1 pl-7 pr-2 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
              width: 280,
            }}
          />
        </div>
      </div>

      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={16} className="animate-spin" style={{ color: BRAND_GREEN }} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {rows.length === 0
              ? (isGlobal
                  ? "No engineers are being rung right now. New offers appear here automatically."
                  : "No engineers in your pod are being rung right now. New offers appear here automatically.")
              : `No matches against “${query}”.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  <Th>Customer · project</Th>
                  <Th>Engineer being rung</Th>
                  <Th>Match score</Th>
                  <Th>Ring left</Th>
                  <Th>Declined</Th>
                  <Th>Queued for</Th>
                  <Th>Tech stack</Th>
                  <Th>Override</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <Row key={r.offerId} row={r} first={i === 0} now={now} onChanged={() => void refresh()} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ row, first, now, onChanged }: { row: MatchingRow; first: boolean; now: number; onChanged: () => void }) {
  const ringMs = row.expiresAt ? new Date(row.expiresAt).getTime() - now : 0;
  const ringS  = Math.max(0, Math.ceil(ringMs / 1000));
  const queuedMs = row.queuedAt ? now - new Date(row.queuedAt).getTime() : 0;

  let ringColor = "var(--text)";
  if (ringS <= COUNTDOWN_CRIT_S)        ringColor = CRIT_RED;
  else if (ringS <= COUNTDOWN_URGENT_S) ringColor = URGENT_AMBER;

  return (
    <tr
      style={{
        borderTop: first ? undefined : "1px solid var(--border)",
        color: "var(--text)",
      }}
    >
      <Td>
        <div className="font-medium">{row.customer.displayName}</div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {row.projectName ?? row.developing ?? "—"}
        </div>
      </Td>
      <Td>
        {row.allDeclined ? (
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: "color-mix(in srgb, var(--risk) 14%, transparent)", color: "var(--risk)" }}
          >
            {row.declinedBy.length <= 1 ? "Engineer declined" : "All engineers declined"}
          </span>
        ) : (
          <>
            <div className="font-medium">{row.engineer.displayName}</div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {row.engineer.email}
              {row.engineer.experienceLevel ? ` · ${row.engineer.experienceLevel}` : ""}
            </div>
          </>
        )}
      </Td>
      <Td>
        <span className="tabular-nums">{row.allDeclined ? "—" : row.matchScore.toFixed(1)}</span>
      </Td>
      <Td>
        {row.allDeclined ? (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ) : (
          <span className="tabular-nums font-medium" style={{ color: ringColor }}>
            {ringS}s
          </span>
        )}
      </Td>
      <Td>
        {row.declinedBy.length === 0 ? (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ) : (
          <span
            title={row.declinedBy.map((d) => d.displayName).join(", ")}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
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
            {row.technologies.slice(0, 4).map((t) => (
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
            {row.technologies.length > 4 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                +{row.technologies.length - 4}
              </span>
            )}
          </div>
        )}
      </Td>
      <Td>
        {/* The manual "Broadcast to all" only appears once a broadcast
            ROUND has been exhausted — i.e. 2+ engineers declined. After a
            single (first) decline the broadcast fires automatically, so the
            supervisor just gets Assign here, not a redundant broadcast
            button. */}
        <MatchingActions
          intakeId={row.intakeId}
          onChanged={onChanged}
          allDeclined={row.allDeclined && row.declinedBy.length >= 2}
        />
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
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
