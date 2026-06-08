"use client";

/*
 * Channel Partner — Invitations view (reseller-scoped redesign).
 *
 * Reads the same data as the shared InviteStatusTable (/api/invite, scoped to
 * the caller server-side, live via Realtime on public.invites) but presents it
 * for the partner portfolio: a stat strip (accepted / awaiting / revoked), a
 * search box + status filter chips, and a table with logo avatars, semantic
 * status badges, and a relative-time line under each Sent date.
 *
 * Status colours (shared with the Clients grid): green = accepted, amber =
 * sent/opened (awaiting), red = revoked. Resend/revoke stay on pending rows
 * only; everything else shows a dash.
 *
 * This is intentionally separate from InviteStatusTable (which is still used by
 * the enterprise + department panels) so the redesign is scoped to the reseller
 * surface and doesn't change those.
 */

import { useEffect, useMemo, useState } from "react";
import { RotateCw, Ban, Loader2, Inbox, Search } from "lucide-react";
import { StatusBadge, EmptyState, Avatar } from "@/app/_components/ui";
import { useApiData } from "@/app/(staff)/enterprise/v2/_shared";
import { createClient } from "@/lib/supabase/browser";

type Invite = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  company_name: string | null;
  status: string;
  sent_at: string;
  opened_at: string | null;
  accepted_at: string | null;
  expires_at: string;
};

// Semantic tone per status — green/amber/red, shared with the Clients grid.
const TONE: Record<string, "ok" | "warn" | "risk" | "neutral"> = {
  accepted: "ok",
  opened: "warn",
  sent: "warn",
  expired: "neutral",
  revoked: "risk",
};

type Filter = "all" | "accepted" | "sent" | "revoked";
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "accepted", label: "Accepted" },
  { key: "sent", label: "Sent" },
  { key: "revoked", label: "Revoked" },
];

// A "pending" invite (sent or opened-but-not-accepted) is the only state where
// resend/revoke make sense.
const isPending = (s: string) => s === "sent" || s === "opened";

// Coarse bucket used by the filter chips (opened folds into "sent"; expired
// only appears under "All").
function bucket(status: string): Filter | "expired" {
  if (status === "accepted") return "accepted";
  if (status === "revoked") return "revoked";
  if (isPending(status)) return "sent";
  return "expired";
}

export function InvitationsView({ reloadKey = 0 }: { reloadKey?: number }) {
  // reloadKey is a cache-buster: bumping it changes the url so useApiData refetches.
  const { data, loading, error, reload } = useApiData<{ invites: Invite[] }>(
    `/api/invite?r=${reloadKey}`
  );
  const rows = useMemo(() => data?.invites ?? [], [data]);
  const [acting, setActing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Realtime: refetch whenever any visible-to-us invite row changes (e.g. the
  // recipient signs in and the trigger flips status to 'accepted').
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("reseller-invitations-view")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invites" },
        () => {
          reload();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && bucket(r.status) !== filter) return false;
      if (!q) return true;
      return [r.company_name, r.name, r.email].some((v) =>
        (v ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, query]);

  const act = async (id: string, method: "PATCH" | "DELETE") => {
    setActing(id);
    try {
      await fetch(`/api/invite/${id}`, { method });
      reload();
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 py-8 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <Loader2 size={16} className="animate-spin" /> Loading invitations…
      </div>
    );
  }
  if (error) {
    return (
      <p className="py-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Controls: search + status filter chips */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invitations…"
            className="w-full rounded-lg border bg-transparent py-2 pr-2 pl-8 text-sm outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: active ? "var(--primary)" : "var(--border)",
                  background: active ? "var(--primary-tint)" : "transparent",
                  color: active ? "var(--primary-hover)" : "var(--text-muted)",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          compact
          icon={<Inbox size={18} />}
          title="No invitations"
          body={
            rows.length === 0
              ? "Invites you send appear here with their status."
              : "No invitations match your filters."
          }
        />
      ) : (
        <div
          className="overflow-x-auto rounded-2xl border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr style={{ color: "var(--text-muted)" }}>
                <th className="px-4 py-2.5 text-left font-medium">Recipient</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Sent</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const display = r.company_name || r.name || r.email;
                return (
                  <tr
                    key={r.id}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          size="sm"
                          name={display}
                          email={r.email}
                          tone="brand"
                        />
                        <div className="min-w-0">
                          <div
                            className="truncate"
                            style={{ color: "var(--text)" }}
                          >
                            {display}
                          </div>
                          <div
                            className="truncate text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {r.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge compact tone={TONE[r.status] ?? "neutral"}>
                        {r.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <div style={{ color: "var(--text)" }}>
                        {new Date(r.sent_at).toLocaleDateString()}
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {relativeTime(r.sent_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isPending(r.status) ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={acting === r.id}
                            onClick={() => act(r.id, "PATCH")}
                            title="Resend"
                            className="inline-flex size-7 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-raised)]"
                            style={{
                              borderColor: "var(--border)",
                              color: "var(--text-muted)",
                            }}
                          >
                            <RotateCw size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={acting === r.id}
                            onClick={() => act(r.id, "DELETE")}
                            title="Revoke"
                            className="inline-flex size-7 items-center justify-center rounded-md border transition-colors hover:bg-[var(--risk-soft)]"
                            style={{
                              borderColor: "var(--border)",
                              color: "var(--risk)",
                            }}
                          >
                            <Ban size={13} />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="text-right"
                          style={{ color: "var(--text-faint)" }}
                        >
                          —
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
