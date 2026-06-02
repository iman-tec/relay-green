"use client";

/*
 * Customer "Contract management" — surfaces go-live / maintenance bids the
 * Relay team sent back. A blinking dot flags a freshly-arrived bid; opening it
 * marks it seen, shows the one-page estimate + the T&C link, and lets the
 * customer either ask for an appointment to talk it through or accept the
 * estimate. Accepting commits the contract (no online payment step —
 * billing is arranged off-platform); work then moves to the next stage.
 *
 * Always renders its collapsible bar (even with zero bids, showing an empty
 * state) so the sidebar's nav set stays stable.
 */

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Rocket,
  Wrench,
  X,
  Loader2,
  Printer,
  ExternalLink,
  Check,
  ShieldCheck,
  CalendarClock,
  ChevronDown,
  ArrowRight,
  Trash2,
  ThumbsDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";
import { SupervisorScheduleModal } from "@/app/_components/SupervisorScheduleModal";

const eur = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format((cents || 0) / 100);

export type Quote = {
  id: string;
  kind: "golive" | "maintain" | string;
  status: string;
  project_id: string;
  quote_amount_cents: number | null;
  bid_scope: string | null;
  bid_timeline: string | null;
  bid_validity_until: string | null;
  terms_url: string | null;
  comments: string | null;
  customer_viewed_at: string | null;
  appointment_requested_at: string | null;
  committed_at: string | null;
  customer_response_note: string | null;
};

export function ContractManagement({
  isOpen,
  onToggle,
  onNavigate,
}: {
  /** Accordion state owned by the Sidebar — opening one of the sidebar's
   *  collapsible bars collapses the others. */
  isOpen: boolean;
  onToggle: () => void;
  /** When set, the pill is a NAV button (→) that opens the center pane instead
   *  of expanding inline. The inline bid list is suppressed in this mode. */
  onNavigate?: () => void;
}) {
  const [sb] = useState(() => createClient());
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [projNames, setProjNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Quote | null>(null);
  // When a row's trash icon opens the viewer, jump straight to the delete
  // panel (with its reason pills + note) instead of the estimate actions.
  const [openInDelete, setOpenInDelete] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return;
    const { data } = await sb
      .from("project_quote_requests")
      .select(
        "id, kind, status, project_id, quote_amount_cents, bid_scope, bid_timeline, bid_validity_until, terms_url, comments, customer_viewed_at, appointment_requested_at, committed_at, customer_response_note"
      )
      .eq("customer_user_id", u.user.id)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Quote[];
    // Resolve project names BEFORE committing state so the list + bid viewer
    // never flash the "Project" fallback (avoids a setQuotes/setProjNames race).
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
  }, [sb]);

  // Seamless delete: drop the row + close the viewer immediately (optimistic),
  // then fire the request. On failure we re-sync so the row reappears intact.
  // Active contracts are guarded server-side and never expose a delete path.
  const deleteQuote = useCallback(
    async (id: string, reason: string) => {
      setQuotes((qs) => qs.filter((x) => x.id !== id));
      setOpen(null);
      setOpenInDelete(false);
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
      .channel("relay-contracts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_quote_requests" },
        () => void load()
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, load]);

  const freshBids = quotes.filter(
    (q) => q.status === "quoted" && !q.customer_viewed_at
  ).length;

  // Borderless pill — hidden entirely until a bid exists (Claude-style: empty
  // sections don't clutter the sidebar).
  if (quotes.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={onNavigate ?? onToggle}
        aria-expanded={onNavigate ? undefined : isOpen}
        className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
      >
        <FileText size={12} style={{ color: "var(--primary)" }} />
        <span
          className="flex-1 text-[12px] font-semibold"
          style={{ color: "var(--text)" }}
        >
          Contract Management
        </span>
        {freshBids > 0 && (
          <span className="relative inline-flex size-2">
            <span
              className="absolute inline-flex size-full animate-ping rounded-full opacity-70"
              style={{ background: "var(--primary)" }}
            />
            <span
              className="relative inline-flex size-2 rounded-full"
              style={{ background: "var(--primary)" }}
            />
          </span>
        )}
        {freshBids > 0 && (
          <span
            className="text-[10px] font-medium"
            style={{ color: "var(--primary)" }}
          >
            {freshBids} new
          </span>
        )}
        <span
          className="text-[10px] font-medium tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {quotes.length}
        </span>
        {onNavigate ? (
          <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
            style={{ color: "var(--text-muted)" }}
          />
        )}
      </button>
      {/* Inline bid list — suppressed in nav (→) mode (the center pane owns
          the full list there). */}
      {isOpen && !onNavigate && quotes.length > 0 && (
        <ul
          className="hide-scrollbar mt-0.5 overflow-y-auto"
          style={{ maxHeight: "5.3rem" }}
        >
          {quotes.map((q) => {
            const golive = q.kind === "golive";
            const fresh = q.status === "quoted" && !q.customer_viewed_at;
            // Active contracts can't be deleted — they're a live obligation
            // (guarded server-side too). Every other state gets the trash.
            const deletable = q.status !== "committed";
            return (
              <li
                key={q.id}
                className="group/bid relative border-t first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenInDelete(false);
                    setOpen(q);
                  }}
                  disabled={
                    q.status === "pending" || q.status === "pending_review"
                  }
                  className="flex w-full items-center gap-2 px-3 py-1.5 pr-9 text-left transition-colors hover:bg-black/[0.03] disabled:cursor-default dark:hover:bg-white/[0.03]"
                >
                  <span
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: "var(--primary-soft)",
                      color: "var(--primary)",
                    }}
                  >
                    {golive ? <Rocket size={10} /> : <Wrench size={10} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[11.5px] leading-tight"
                      style={{ color: "var(--text)" }}
                    >
                      {projNames[q.project_id] ?? "Project"}{" "}
                      <span style={{ color: "var(--text-faint)" }}>
                        · {golive ? "Go-live" : "Maintain"}
                      </span>
                    </div>
                    <div
                      className="truncate text-[10px] leading-tight"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {statusLabel(q.status)}
                    </div>
                  </div>
                  {fresh && (
                    <span className="relative inline-flex size-2">
                      <span
                        className="absolute inline-flex size-full animate-ping rounded-full opacity-70"
                        style={{ background: "var(--primary)" }}
                      />
                      <span
                        className="relative inline-flex size-2 rounded-full"
                        style={{ background: "var(--primary)" }}
                      />
                    </span>
                  )}
                  {q.status === "committed" && (
                    <ShieldCheck size={12} style={{ color: "var(--ok)" }} />
                  )}
                </button>

                {/* Quick delete — hover-revealed trash that opens the bid
                    viewer straight onto its delete panel (reason pills + note),
                    so every delete is captured the same way. Sits in the
                    button's reserved right padding (pr-9) so it never collides
                    with the fresh-dot / active badge. Hidden for live
                    contracts. */}
                {deletable && (
                  <div className="absolute inset-y-0 right-1.5 flex items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenInDelete(true);
                        setOpen(q);
                      }}
                      title="Delete bid"
                      aria-label="Delete bid"
                      className="inline-flex size-6 items-center justify-center rounded-md opacity-0 transition-all group-hover/bid:opacity-100 hover:bg-black/5 hover:text-[var(--risk)] focus-visible:opacity-100 dark:hover:bg-white/10"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <BidViewer
          quote={open}
          projectName={projNames[open.project_id] ?? "Project"}
          initialDelete={openInDelete}
          onDelete={deleteQuote}
          onClose={() => {
            setOpen(null);
            setOpenInDelete(false);
          }}
          onChanged={() => {
            void load();
          }}
        />
      )}
    </section>
  );
}

function statusLabel(s: string): string {
  return s === "pending"
    ? "Request sent — awaiting the team's bid"
    : // pending_review is an internal staff state (engineer bid awaiting
      // supervisor approval). To the customer it's still "awaiting the bid".
      s === "pending_review"
      ? "Request sent — awaiting the team's bid"
      : s === "quoted"
        ? "Bid ready — review & commit"
        : s === "committed"
          ? "Contract active"
          : s === "declined"
            ? "Declined"
            : s === "cancelled"
              ? "Cancelled"
              : s;
}

// Quick-pick reasons that pre-fill the delete note (the box stays editable).
// Mirrors the appointment-cancel pattern so the two flows feel the same.
const DELETE_REASONS = ["No longer needed", "Created by mistake"];

// Quick-pick reasons for declining a bid. The reason is mandatory and is
// surfaced to the supervisor (act-now rail) so they know why it was rejected.
const DECLINE_REASONS = [
  "Too expensive",
  "Timeline too long",
  "Scope isn't right",
];

export function BidViewer({
  quote,
  projectName,
  initialDelete = false,
  inline = false,
  onDelete,
  onClose,
  onChanged,
}: {
  quote: Quote;
  projectName: string;
  /** Open straight onto the delete panel (set when the row trash launched us). */
  initialDelete?: boolean;
  /** Render in-flow (accordion under a list row) instead of as a modal popup —
   *  no scrim, no fixed positioning, no scroll-lock. */
  inline?: boolean;
  /** Parent-owned optimistic delete: drops the row + closes us immediately. */
  onDelete: (id: string, reason: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sb] = useState(() => createClient());
  const [appt, setAppt] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);
  const [committed, setCommitted] = useState(quote.status === "committed");
  const [declined, setDeclined] = useState(quote.status === "declined");
  // Reject (decline) — expands a reason panel (pills + REQUIRED note). The
  // reason is recorded on the bid so the supervisor sees why it was rejected.
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declining, setDeclining] = useState(false);
  // Delete — a focused confirm panel (reason pills + required note). When open
  // it replaces the estimate body so there's one unambiguous action. Opened
  // immediately when the row trash launched the viewer.
  const [showDelete, setShowDelete] = useState(initialDelete);
  const [deleteReason, setDeleteReason] = useState("");
  const [booking, setBooking] = useState<{
    id: string;
    slotStart: string;
  } | null>(null);
  const [bkTick, setBkTick] = useState(0); // bump to reload the booking
  const dialogRef = useOverlayDismiss(onClose, !inline);

  // Mark the bid seen (clears the blinking dot) on open.
  useEffect(() => {
    if (quote.status === "quoted" && !quote.customer_viewed_at) {
      void sb
        .rpc("mark_quote_viewed", { _id: quote.id })
        .then(() => onChanged());
    }
  }, [quote.id, quote.status, quote.customer_viewed_at, sb, onChanged]);

  // Load the customer's upcoming appointment for this bid (if any), so the
  // primary action becomes "Change appointment" instead of "Ask for appointment".
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("supervisor_bookings")
        .select("id, slot_start")
        .eq("quote_id", quote.id)
        .eq("customer_user_id", u.user.id)
        .eq("status", "booked")
        .gte("slot_end", new Date().toISOString())
        .order("slot_start", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      const row = data as { id: string; slot_start: string } | null;
      setBooking(row ? { id: row.id, slotStart: row.slot_start } : null);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [sb, quote.id, bkTick]);

  const golive = quote.kind === "golive";
  const amount = quote.quote_amount_cents ?? 0;

  // Accept the estimate WITHOUT an online payment — commits the contract
  // server-side (billing is arranged off-platform / via the appointment).
  const handleAccept = async () => {
    if (accepting) return;
    setAccepting(true);
    setAcceptErr(null);
    try {
      const res = await fetch("/api/contract/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Couldn't accept the estimate.");
      }
      setCommitted(true);
      onChanged();
    } catch (e) {
      setAcceptErr(
        e instanceof Error ? e.message : "Couldn't accept the estimate."
      );
      setAccepting(false);
    }
  };

  // Reject the bid — records 'declined' + the REQUIRED reason (shown to the
  // supervisor). The team can re-bid later; the customer can also delete it
  // outright (handleDelete).
  const handleDecline = async () => {
    const reason = declineReason.trim();
    if (declining || !reason) return;
    setDeclining(true);
    setAcceptErr(null);
    try {
      const res = await fetch("/api/contract/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id, note: reason }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Couldn't decline the estimate.");
      }
      setDeclined(true);
      setConfirmDecline(false);
      onChanged();
    } catch (e) {
      setAcceptErr(
        e instanceof Error ? e.message : "Couldn't decline the estimate."
      );
    } finally {
      setDeclining(false);
    }
  };

  // Delete the request. A reason is required (button is disabled until then).
  // The parent removes the row + closes us instantly and fires the request in
  // the background, so deletion feels seamless and can't half-complete here.
  const handleDelete = () => {
    const reason = deleteReason.trim();
    if (!reason) return;
    onDelete(quote.id, reason);
  };

  return (
    <>
      {!inline && (
        <div
          className="fixed inset-0 z-[var(--z-modal)]"
          style={{ backgroundColor: "var(--scrim)" }}
          onClick={onClose}
        />
      )}
      <div
        ref={dialogRef}
        role={inline ? undefined : "dialog"}
        aria-modal={inline ? undefined : true}
        className={
          inline
            ? "mt-1.5 flex flex-col gap-3 rounded-xl border p-4"
            : "fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        }
        style={{
          borderColor: "var(--border)",
          backgroundColor: inline
            ? "var(--surface-raised)"
            : "var(--surface)",
        }}
      >
        <div className="flex items-start gap-2">
          {golive ? (
            <Rocket size={18} style={{ color: "var(--primary)" }} />
          ) : (
            <Wrench size={18} style={{ color: "var(--primary)" }} />
          )}
          <div className="min-w-0 flex-1">
            <h2
              className="text-[15px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              {golive ? "Go-live" : "Maintenance"} estimate — {projectName}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {committed
                ? "Contract active — work is underway."
                : declined
                  ? "You declined this estimate."
                  : "Review your estimate and the terms, then commit."}
            </p>
          </div>
          {/* Delete request — removes the bid from your list. Hidden once a
              contract is active (a live obligation can't be deleted) AND while
              the delete panel is already open (the panel is the delete flow —
              a second trash here just creates confusion). */}
          {!committed && !showDelete && (
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              aria-label="Delete request"
              title="Delete request"
              className="rounded-md p-1 transition-colors hover:bg-black/5 hover:text-[var(--risk)] dark:hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Delete confirm panel — the single, focused delete action. When
            open it REPLACES the estimate body below, so there's no competing
            Accept/Decline button to muddy the choice. A reason is required:
            pick a pill or type one; Delete stays disabled until then. */}
        {showDelete && !committed ? (
          <div
            className="flex flex-col gap-2 rounded-xl border px-3 py-2.5"
            style={{
              borderColor: "var(--risk)",
              background: "color-mix(in srgb, var(--risk) 7%, transparent)",
            }}
          >
            <span className="text-[12.5px]" style={{ color: "var(--text)" }}>
              Delete this request? This removes it from your list for good.
            </span>
            <span
              className="text-[10px] font-semibold tracking-wider uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Reason for deleting{" "}
              <span style={{ color: "var(--risk)" }}>*</span>
            </span>
            <div className="flex flex-wrap gap-1">
              {DELETE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDeleteReason(r)}
                  className="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                  style={{
                    borderColor:
                      deleteReason === r ? "var(--risk)" : "var(--border)",
                    color:
                      deleteReason === r ? "var(--risk)" : "var(--text-muted)",
                    background:
                      deleteReason === r
                        ? "color-mix(in srgb, var(--risk) 12%, transparent)"
                        : "transparent",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={2}
              placeholder="Tell us why you're deleting this (required)…"
              className="w-full resize-none rounded-lg border px-2.5 py-1.5 text-[12px] outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--background)",
                color: "var(--text)",
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDelete(false)}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!deleteReason.trim()}
                title={
                  deleteReason.trim()
                    ? "Delete this request"
                    : "Add a reason first"
                }
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "var(--risk)" }}
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── estimate body (hidden while the delete panel is open) ── */}

            {/* PDF 1 — the one-page estimate (printable). */}
            <div
              id="relay-estimate"
              className="rounded-xl border p-4"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-semibold tracking-wide uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  Estimate
                </span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Printer size={12} /> Print / PDF
                </button>
              </div>
              <div
                className="mt-2 font-serif text-3xl tabular-nums"
                style={{ color: "var(--text)" }}
              >
                {eur(amount)}
              </div>
              {quote.bid_scope && (
                <p className="mt-3 text-sm" style={{ color: "var(--text)" }}>
                  <span className="font-medium">Scope: </span>
                  {quote.bid_scope}
                </p>
              )}
              {quote.bid_timeline && (
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span
                    className="font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    Timeline:{" "}
                  </span>
                  {quote.bid_timeline}
                </p>
              )}
              {quote.bid_validity_until && (
                <p
                  className="mt-1 text-xs"
                  style={{ color: "var(--text-faint)" }}
                >
                  Valid until{" "}
                  {new Date(quote.bid_validity_until).toLocaleDateString()}
                </p>
              )}
            </div>

            {/* PDF 2 — general T&C. */}
            <a
              href={quote.terms_url || "/legal/contracting-terms"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <FileText size={15} style={{ color: "var(--text-muted)" }} />
              <span className="flex-1">General Terms &amp; Conditions</span>
              <ExternalLink size={13} style={{ color: "var(--text-muted)" }} />
            </a>

            {committed ? (
              <div
                className="flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium"
                style={{
                  borderColor: "var(--ok)",
                  background: "color-mix(in srgb, var(--ok) 8%, transparent)",
                  color: "var(--ok)",
                }}
              >
                <ShieldCheck size={16} /> Estimate accepted — your engineer is
                on it.
              </div>
            ) : declined ? (
              // Terminal: the customer rejected this estimate. The team can send a
              // revised bid; meanwhile the request can be removed via the header
              // trash. We still show the accept option so a change of heart is one
              // click away.
              <div className="flex flex-col gap-2">
                <div
                  className="flex items-center justify-center gap-2 rounded-xl border py-3 text-[13px] font-medium"
                  style={{
                    borderColor: "var(--border)",
                    background:
                      "color-mix(in srgb, var(--risk) 6%, transparent)",
                    color: "var(--text-muted)",
                  }}
                >
                  <ThumbsDown size={15} /> You declined this estimate.
                </div>
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={accepting}
                  className="inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                  style={{ background: "var(--primary)" }}
                >
                  {accepting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}{" "}
                  Changed your mind? Accept estimate
                </button>
                {acceptErr && (
                  <p
                    className="text-center text-[12px]"
                    style={{ color: "var(--risk)" }}
                  >
                    {acceptErr}
                  </p>
                )}
              </div>
            ) : (
              // Three paths: talk it through (appointment), accept, or reject the
              // estimate. No online payment step — accepting commits the contract
              // and the team arranges billing.
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAppt(true)}
                    disabled={accepting || declining}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    <CalendarClock size={14} />{" "}
                    {booking ? "Change appointment" : "Ask for appointment"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAccept()}
                    disabled={accepting || declining}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--primary)" }}
                  >
                    {accepting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}{" "}
                    Accept estimate
                  </button>
                </div>

                {/* Reject — tapping "Decline estimate" expands a panel that
                    requires a reason (pills + note). The reason is mandatory
                    because the supervisor sees it; Decline stays disabled
                    until one is given. */}
                {confirmDecline ? (
                  <div
                    className="flex flex-col gap-2 rounded-xl border p-3"
                    style={{
                      borderColor: "var(--risk)",
                      background:
                        "color-mix(in srgb, var(--risk) 6%, transparent)",
                    }}
                  >
                    <span
                      className="text-[12.5px]"
                      style={{ color: "var(--text)" }}
                    >
                      Why are you declining this estimate?
                    </span>
                    <span
                      className="text-[10px] font-semibold tracking-wider uppercase"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Reason <span style={{ color: "var(--risk)" }}>*</span>
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {DECLINE_REASONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setDeclineReason(r)}
                          className="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                          style={{
                            borderColor:
                              declineReason === r
                                ? "var(--risk)"
                                : "var(--border)",
                            color:
                              declineReason === r
                                ? "var(--risk)"
                                : "var(--text-muted)",
                            background:
                              declineReason === r
                                ? "color-mix(in srgb, var(--risk) 12%, transparent)"
                                : "transparent",
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      rows={2}
                      placeholder="Tell the team why (required) — helps them re-bid…"
                      className="w-full resize-none rounded-lg border px-2.5 py-1.5 text-[12px] outline-none"
                      style={{
                        borderColor: "var(--border)",
                        background: "var(--background)",
                        color: "var(--text)",
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDecline(false)}
                        disabled={declining}
                        className="inline-flex flex-1 items-center justify-center rounded-full border px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text)",
                        }}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDecline()}
                        disabled={declining || !declineReason.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ background: "var(--risk)" }}
                      >
                        {declining ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ThumbsDown size={14} />
                        )}{" "}
                        Decline estimate
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDecline(true)}
                    disabled={accepting}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
                    style={{ borderColor: "var(--risk)", color: "var(--risk)" }}
                  >
                    <ThumbsDown size={14} /> Decline estimate
                  </button>
                )}

                {acceptErr && (
                  <p
                    className="text-center text-[12px]"
                    style={{ color: "var(--risk)" }}
                  >
                    {acceptErr}
                  </p>
                )}
              </div>
            )}
            {booking && !committed && !declined ? (
              <p
                className="text-center text-[11px]"
                style={{ color: "var(--ok)" }}
              >
                Appointment booked for{" "}
                {new Date(booking.slotStart).toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                — see you then.
              </p>
            ) : quote.appointment_requested_at && !committed && !declined ? (
              <p
                className="text-center text-[11px]"
                style={{ color: "var(--text-faint)" }}
              >
                Appointment requested — the team will reach out.
              </p>
            ) : null}
          </>
        )}
      </div>

      {appt && !committed && (
        <SupervisorScheduleModal
          quoteId={quote.id}
          projectName={projectName}
          replaceBookingId={booking?.id ?? null}
          onClose={() => setAppt(false)}
          onBooked={() => {
            setAppt(false);
            setBkTick((t) => t + 1);
            onChanged();
            // Refresh the sidebar "Appointment scheduled" section.
            window.dispatchEvent(new Event("relay:appointments-changed"));
          }}
        />
      )}
    </>
  );
}
