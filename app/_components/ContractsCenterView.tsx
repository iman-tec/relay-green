"use client";

/*
 * Contracts center-pane view — the customer's bids (go-live / maintenance) as a
 * list; opening one reuses the shared <BidViewer> modal (review / appointment /
 * accept / decline / delete). Empty when there are no bids.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Rocket,
  Wrench,
  ShieldCheck,
  ChevronDown,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { BidViewer, type Quote } from "./ContractManagement";

const eur = (cents: number | null) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format((cents || 0) / 100);

function statusLabel(s: string): string {
  if (s === "pending" || s === "pending_review")
    return "Awaiting the team's bid";
  if (s === "quoted") return "Bid ready — review & commit";
  if (s === "committed") return "Contract active";
  if (s === "declined") return "Declined";
  if (s === "cancelled") return "Cancelled";
  return s;
}

export function ContractsCenterView({
  customerUserId,
}: {
  customerUserId: string | null;
}) {
  const [sb] = useState(() => createClient());
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [projNames, setProjNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // Which bid is expanded inline (accordion) — no modal popups.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!customerUserId) {
      setLoading(false);
      return;
    }
    const { data } = await sb
      .from("project_quote_requests")
      .select(
        "id, kind, status, project_id, quote_amount_cents, bid_scope, bid_timeline, bid_validity_until, terms_url, comments, customer_viewed_at, appointment_requested_at, committed_at, customer_response_note"
      )
      .eq("customer_user_id", customerUserId)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Quote[];
    const ids = [...new Set(rows.map((r) => r.project_id))];
    const m: Record<string, string> = {};
    if (ids.length) {
      const { data: ps } = await sb
        .from("projects")
        .select("id, name")
        .in("id", ids);
      for (const p of (ps ?? []) as { id: string; name: string | null }[])
        if (p.name) m[p.id] = p.name;
    }
    setProjNames(m);
    setQuotes(rows);
    setLoading(false);
  }, [sb, customerUserId]);

  // Optimistic delete: drop the row + close the viewer, then fire the request.
  const deleteQuote = useCallback(
    async (id: string, reason: string) => {
      setQuotes((qs) => qs.filter((x) => x.id !== id));
      setExpandedId(null);
      try {
        const res = await fetch("/api/contract/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId: id, reason }),
        });
        if (!res.ok) throw new Error("delete_failed");
      } catch {
        void load();
      }
    },
    [load]
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const ch = sb
      .channel(`relay-contracts-center-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_quote_requests" },
        () => void load()
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [sb, load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return quotes;
    return quotes.filter((q) =>
      (projNames[q.project_id] ?? "").toLowerCase().includes(term)
    );
  }, [quotes, projNames, query]);

  if (loading) {
    return (
      <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </p>
    );
  }

  if (quotes.length === 0) {
    return (
      <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No bids yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div
        className="flex items-center gap-2 rounded-xl border px-3.5 py-2.5"
        style={{ borderColor: "var(--border)", background: "var(--background)" }}
      >
        <Search size={16} style={{ color: "var(--text-muted)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bids…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
          style={{ color: "var(--text)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <p
          className="py-12 text-center text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          No bids match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((q) => {
            const golive = q.kind === "golive";
            const expandable =
              q.status !== "pending" && q.status !== "pending_review";
            const isExpanded = expandedId === q.id;
            return (
              <li key={q.id}>
                <button
                  type="button"
                  disabled={!expandable}
                  onClick={() => setExpandedId(isExpanded ? null : q.id)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-[var(--primary)] hover:bg-black/[0.02] disabled:cursor-default disabled:opacity-70 dark:hover:bg-white/[0.03]"
                  style={{
                    borderColor: isExpanded
                      ? "var(--primary)"
                      : "var(--border)",
                  }}
                >
                  <span
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: "var(--primary-soft)",
                      color: "var(--primary)",
                    }}
                  >
                    {golive ? <Rocket size={15} /> : <Wrench size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[14px] font-semibold"
                        style={{ color: "var(--text)" }}
                      >
                        {projNames[q.project_id] ?? "Project"}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--text-faint)" }}
                      >
                        · {golive ? "Go-live" : "Maintain"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span
                        className="text-[12px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {statusLabel(q.status)}
                      </span>
                      {/* Price sits here on mobile so the project name keeps
                          its full width; on sm+ it moves to the right column. */}
                      {q.quote_amount_cents != null && (
                        <span
                          className="text-[12px] font-semibold tabular-nums sm:hidden"
                          style={{ color: "var(--text)" }}
                        >
                          {eur(q.quote_amount_cents)}
                        </span>
                      )}
                    </div>
                  </div>
                  {q.quote_amount_cents != null && (
                    <span
                      className="hidden shrink-0 text-[13px] font-semibold tabular-nums sm:block"
                      style={{ color: "var(--text)" }}
                    >
                      {eur(q.quote_amount_cents)}
                    </span>
                  )}
                  {q.status === "committed" && (
                    <ShieldCheck size={15} style={{ color: "var(--ok)" }} />
                  )}
                  {expandable && (
                    <ChevronDown
                      size={16}
                      className={`shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      style={{ color: "var(--text-faint)" }}
                    />
                  )}
                </button>

                {/* Inline accordion — the bid detail/actions expand underneath
                    the row instead of opening a popup. */}
                {isExpanded && expandable && (
                  <BidViewer
                    quote={q}
                    projectName={projNames[q.project_id] ?? "Project"}
                    inline
                    onDelete={deleteQuote}
                    onClose={() => setExpandedId(null)}
                    onChanged={() => void load()}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
