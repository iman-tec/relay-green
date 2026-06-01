"use client";

/*
 * Customer "Contract management" — surfaces go-live / maintenance bids the
 * Relay team sent back. A blinking dot flags a freshly-arrived bid; opening it
 * marks it seen, shows the one-page estimate + the T&C link, and lets the
 * customer either ask for an appointment to talk it through or accept the
 * estimate. Accepting commits the contract (no online payment step —
 * billing is arranged off-platform); work then moves to the next stage.
 *
 * Renders nothing until the customer has at least one quote request.
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";
import { SupervisorScheduleModal } from "@/app/_components/SupervisorScheduleModal";

const eur = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format((cents || 0) / 100);

type Quote = {
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
  collapsedByDefault = false,
}: {
  /** Start collapsed (header + reopen button only). Used when the customer has
   *  an appointment, so the appointment takes visual priority below. */
  collapsedByDefault?: boolean;
} = {}) {
  const [sb] = useState(() => createClient());
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [projNames, setProjNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Quote | null>(null);
  // null = follow collapsedByDefault; once the customer clicks, their choice wins.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);

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

  if (quotes.length === 0) return null;
  const freshBids = quotes.filter(
    (q) => q.status === "quoted" && !q.customer_viewed_at
  ).length;
  // Collapsible only when asked (an appointment exists); otherwise always open.
  const collapsed = collapsedByDefault ? (userToggled ?? true) : false;

  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header className="flex items-center gap-1.5 px-3 py-2">
        <FileText size={12} style={{ color: "var(--primary)" }} />
        <h3
          className="text-[12px] font-semibold"
          style={{ color: "var(--text)" }}
        >
          Contract management
        </h3>
        {freshBids > 0 && (
          <span className="relative ml-1 inline-flex size-2">
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
        {collapsedByDefault && (
          <button
            type="button"
            onClick={() => setUserToggled(!collapsed)}
            aria-label={collapsed ? "Reopen contract management" : "Collapse"}
            className="ml-auto flex size-5 items-center justify-center rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <ChevronDown size={14} className={collapsed ? "" : "rotate-180"} />
          </button>
        )}
      </header>
      {/* Show at most two bids; the rest scroll inside this section with a
          visible (slim) scrollbar so the overflow is obvious. */}
      {!collapsed && (
        <ul
          className="overflow-y-auto border-t [scrollbar-width:thin]"
          style={{ borderColor: "var(--border)", maxHeight: "5.3rem" }}
        >
          {quotes.map((q) => {
            const golive = q.kind === "golive";
            const fresh = q.status === "quoted" && !q.customer_viewed_at;
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setOpen(q)}
                  disabled={
                    q.status === "pending" || q.status === "pending_review"
                  }
                  className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left transition-colors first:border-t-0 hover:bg-black/[0.03] disabled:cursor-default dark:hover:bg-white/[0.03]"
                  style={{ borderColor: "var(--border)" }}
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
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <BidViewer
          quote={open}
          projectName={projNames[open.project_id] ?? "Project"}
          onClose={() => setOpen(null)}
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

function BidViewer({
  quote,
  projectName,
  onClose,
  onChanged,
}: {
  quote: Quote;
  projectName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sb] = useState(() => createClient());
  const [appt, setAppt] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);
  const [committed, setCommitted] = useState(quote.status === "committed");
  const [booking, setBooking] = useState<{
    id: string;
    slotStart: string;
  } | null>(null);
  const [bkTick, setBkTick] = useState(0); // bump to reload the booking
  const dialogRef = useOverlayDismiss(onClose);

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

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        style={{ backgroundColor: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-[var(--z-modal)] flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
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
                : "Review your estimate and the terms, then commit."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

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
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text)" }}>
                Timeline:{" "}
              </span>
              {quote.bid_timeline}
            </p>
          )}
          {quote.bid_validity_until && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
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
            <ShieldCheck size={16} /> Estimate accepted — your engineer is on
            it.
          </div>
        ) : (
          // Two actions: schedule an appointment with the supervisor to talk it
          // through, or accept the estimate. No online payment step — accepting
          // commits the contract and the team arranges billing.
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAppt(true)}
                disabled={accepting}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                <CalendarClock size={14} />{" "}
                {booking ? "Change appointment" : "Ask for appointment"}
              </button>
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={accepting}
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
        {booking && !committed ? (
          <p className="text-center text-[11px]" style={{ color: "var(--ok)" }}>
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
        ) : quote.appointment_requested_at && !committed ? (
          <p
            className="text-center text-[11px]"
            style={{ color: "var(--text-faint)" }}
          >
            Appointment requested — the team will reach out.
          </p>
        ) : null}
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
