"use client";

/*
 * Sessions — this department's session history with search + status filter.
 * PII-minimized (own-dept member names allowed; no email/AI summary).
 */

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import { useApiData, eur, LoadingState, ErrorState } from "@/app/(staff)/enterprise/v2/_shared";
import {
  TabBody, TabTitle, BRAND_GREEN, BRAND_GREEN_SOFT,
} from "@/app/(staff)/enterprise/v2/_kit";

type Session = {
  id: string; status: string; urgency: string; createdAt: string;
  durationMinutes: number | null; chargeCents: number | null;
  memberName: string; projectName: string | null;
};

const TONE: Record<string, "ok" | "warn" | "risk" | "neutral" | "info"> = {
  live: "ok", joining: "ok", assigned: "info", queued: "warn", grace: "warn", ending: "info",
  ended: "neutral", cancelled: "risk", abandoned: "risk", expired_free: "neutral",
};
// "Live" = a call that's actually connected/connecting with an engineer
// (assigned → joining → live → grace → ending). Queued ("Connecting
// customer…", no engineer yet) is NOT live — and a stale queued row that
// never got reaped would otherwise linger under Live forever.
const LIVE_STATUSES = new Set(["assigned", "joining", "live", "grace", "ending"]);
const FILTERS = ["all", "live", "ended", "cancelled"] as const;

export function SessionsTab() {
  const { data, loading, error, reload } = useApiData<{ sessions: Session[] }>("/api/department/sessions?limit=200");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  // Keep the list current so live sessions surface without a manual reload.
  useEffect(() => {
    const id = setInterval(() => { reload(); }, 15000);
    return () => clearInterval(id);
  }, [reload]);

  const rows = useMemo(() => {
    const all = data?.sessions ?? [];
    return all.filter((s) => {
      const matchesFilter =
        filter === "all"  ? true
        : filter === "live" ? LIVE_STATUSES.has(s.status)
        : s.status === filter;
      if (!matchesFilter) return false;
      if (q && !(`${s.memberName} ${s.projectName ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [data, q, filter]);

  return (
    <TabBody>
      <TabTitle title="Sessions" />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search member or project…"
            className="h-10 w-full rounded-lg border pl-9 pr-3 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}
          />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="rounded-md px-2.5 py-1.5 text-xs capitalize transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{
                fontWeight: filter === f ? 600 : 500,
                background: filter === f ? BRAND_GREEN_SOFT : "transparent",
                color: filter === f ? BRAND_GREEN : "var(--text-muted)",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No sessions" body={q || filter !== "all" ? "No sessions match your filters." : "Sessions from your team will appear here."} />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <ul>
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--text)" }}>
                    {s.memberName || "—"}
                    {s.projectName ? <span style={{ color: "var(--text-faint)" }}> · {s.projectName}</span> : null}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {new Date(s.createdAt).toLocaleString()} · {s.durationMinutes ? `${s.durationMinutes}m` : "—"} · {s.chargeCents != null ? eur(s.chargeCents) : "—"}
                  </div>
                </div>
                <StatusBadge compact tone={TONE[s.status] ?? "neutral"}>{s.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TabBody>
  );
}
