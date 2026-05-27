"use client";

/*
 * Customer "Contract management" — surfaces go-live / maintenance bids the
 * Relay team sent back. A blinking dot flags a freshly-arrived bid; opening it
 * marks it seen, shows the one-page estimate + the T&C link, and lets the
 * customer request an appointment or pay & commit (Stripe). On payment the
 * contract is committed and work moves to the next stage.
 *
 * Renders nothing until the customer has at least one quote request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { FileText, Rocket, Wrench, X, Loader2, Printer, ExternalLink, CalendarClock, Check, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { useTheme } from "@/app/_components/ThemeProvider";
import { buildStripeAppearance } from "@/lib/stripe/appearance";

const STRIPE_PK = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) || "";
let _sp: Promise<StripeJs | null> | null = null;
const stripePromise = () => { if (!STRIPE_PK) return null; if (!_sp) _sp = loadStripe(STRIPE_PK); return _sp; };

const eur = (cents: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format((cents || 0) / 100);

type Quote = {
  id: string; kind: "golive" | "maintain" | string; status: string; project_id: string;
  quote_amount_cents: number | null; bid_scope: string | null; bid_timeline: string | null;
  bid_validity_until: string | null; terms_url: string | null; comments: string | null;
  customer_viewed_at: string | null; appointment_requested_at: string | null; committed_at: string | null;
};

export function ContractManagement() {
  const sb = useRef(createClient()).current;
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [projNames, setProjNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Quote | null>(null);

  const load = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return;
    const { data } = await sb
      .from("project_quote_requests")
      .select("id, kind, status, project_id, quote_amount_cents, bid_scope, bid_timeline, bid_validity_until, terms_url, comments, customer_viewed_at, appointment_requested_at, committed_at")
      .eq("customer_user_id", u.user.id)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as Quote[];
    // Resolve project names BEFORE committing state so the list + bid viewer
    // never flash the "Project" fallback (avoids a setQuotes/setProjNames race).
    const ids = [...new Set(rows.map((r) => r.project_id))];
    const m: Record<string, string> = {};
    if (ids.length) {
      const { data: ps } = await sb.from("projects").select("id, name").in("id", ids);
      for (const p of (ps ?? []) as { id: string; name: string | null }[]) if (p.name) m[p.id] = p.name;
    }
    setProjNames(m);
    setQuotes(rows);
  }, [sb]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const ch = sb.channel("relay-contracts").on("postgres_changes", { event: "*", schema: "public", table: "project_quote_requests" }, () => void load()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, load]);

  if (quotes.length === 0) return null;
  const freshBids = quotes.filter((q) => q.status === "quoted" && !q.customer_viewed_at).length;

  return (
    <section className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <header className="flex items-center gap-2 px-4 py-3">
        <FileText size={15} style={{ color: "var(--primary)" }} />
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Contract management</h3>
        {freshBids > 0 && (
          <span className="relative ml-1 inline-flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full opacity-70" style={{ background: "var(--primary)" }} />
            <span className="relative inline-flex size-2.5 rounded-full" style={{ background: "var(--primary)" }} />
          </span>
        )}
        {freshBids > 0 && <span className="text-xs font-medium" style={{ color: "var(--primary)" }}>{freshBids} new bid{freshBids === 1 ? "" : "s"}</span>}
      </header>
      <ul className="border-t" style={{ borderColor: "var(--border)" }}>
        {quotes.map((q) => {
          const golive = q.kind === "golive";
          const fresh = q.status === "quoted" && !q.customer_viewed_at;
          return (
            <li key={q.id}>
              <button type="button" onClick={() => setOpen(q)} disabled={q.status === "pending"}
                className="flex w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-black/[0.03] disabled:cursor-default dark:hover:bg-white/[0.03]"
                style={{ borderColor: "var(--border)" }}>
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                  {golive ? <Rocket size={14} /> : <Wrench size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: "var(--text)" }}>{projNames[q.project_id] ?? "Project"} <span style={{ color: "var(--text-faint)" }}>· {golive ? "Go-live" : "Maintain"}</span></div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>{statusLabel(q.status)}</div>
                </div>
                {fresh && <span className="relative inline-flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full opacity-70" style={{ background: "var(--primary)" }} /><span className="relative inline-flex size-2.5 rounded-full" style={{ background: "var(--primary)" }} /></span>}
                {q.status === "committed" && <ShieldCheck size={16} style={{ color: "var(--ok)" }} />}
              </button>
            </li>
          );
        })}
      </ul>
      {open && <BidViewer quote={open} projectName={projNames[open.project_id] ?? "Project"} onClose={() => setOpen(null)} onChanged={() => { void load(); }} />}
    </section>
  );
}

function statusLabel(s: string): string {
  return s === "pending" ? "Request sent — awaiting the team's bid"
    : s === "quoted" ? "Bid ready — review & commit"
    : s === "committed" ? "Contract active"
    : s === "declined" ? "Declined"
    : s === "cancelled" ? "Cancelled" : s;
}

function BidViewer({ quote, projectName, onClose, onChanged }: { quote: Quote; projectName: string; onClose: () => void; onChanged: () => void }) {
  const sb = useRef(createClient()).current;
  const [paying, setPaying] = useState(false);
  const [appt, setAppt] = useState(false);
  const [committed, setCommitted] = useState(quote.status === "committed");

  // Mark the bid seen (clears the blinking dot) on open.
  useEffect(() => {
    if (quote.status === "quoted" && !quote.customer_viewed_at) {
      void sb.rpc("mark_quote_viewed", { _id: quote.id }).then(() => onChanged());
    }
  }, [quote.id, quote.status, quote.customer_viewed_at, sb, onChanged]);

  const golive = quote.kind === "golive";
  const amount = quote.quote_amount_cents ?? 0;

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ backgroundColor: "var(--scrim)" }} onClick={() => !paying && onClose()} />
      <div role="dialog" aria-modal="true" className="fixed left-1/2 top-1/2 z-[81] flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <div className="flex items-start gap-2">
          {golive ? <Rocket size={18} style={{ color: "var(--primary)" }} /> : <Wrench size={18} style={{ color: "var(--primary)" }} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>{golive ? "Go-live" : "Maintenance"} estimate — {projectName}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{committed ? "Contract active — work is underway." : "Review your estimate and the terms, then commit."}</p>
          </div>
          <button type="button" onClick={() => !paying && onClose()} style={{ color: "var(--text-muted)" }}><X size={16} /></button>
        </div>

        {/* PDF 1 — the one-page estimate (printable). */}
        <div id="relay-estimate" className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Estimate</span>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}><Printer size={12} /> Print / PDF</button>
          </div>
          <div className="mt-2 font-serif text-3xl tabular-nums" style={{ color: "var(--text)" }}>{eur(amount)}</div>
          {quote.bid_scope && <p className="mt-3 text-sm" style={{ color: "var(--text)" }}><span className="font-medium">Scope: </span>{quote.bid_scope}</p>}
          {quote.bid_timeline && <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}><span className="font-medium" style={{ color: "var(--text)" }}>Timeline: </span>{quote.bid_timeline}</p>}
          {quote.bid_validity_until && <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>Valid until {new Date(quote.bid_validity_until).toLocaleDateString()}</p>}
        </div>

        {/* PDF 2 — general T&C. */}
        <a href={quote.terms_url || "/legal/contracting-terms"} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}>
          <FileText size={15} style={{ color: "var(--text-muted)" }} />
          <span className="flex-1">General Terms &amp; Conditions</span>
          <ExternalLink size={13} style={{ color: "var(--text-muted)" }} />
        </a>

        {committed ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium" style={{ borderColor: "var(--ok)", background: "color-mix(in srgb, var(--ok) 8%, transparent)", color: "var(--ok)" }}>
            <ShieldCheck size={16} /> Contract committed — your engineer is on it.
          </div>
        ) : paying ? (
          <PayPanel quoteId={quote.id} amount={amount} onPaid={() => { setCommitted(true); onChanged(); }} onCancel={() => setPaying(false)} />
        ) : appt ? (
          <ApptPanel quoteId={quote.id} onDone={() => { setAppt(false); onChanged(); }} onCancel={() => setAppt(false)} />
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setAppt(true)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              <CalendarClock size={14} /> Ask for appointment
            </button>
            <button type="button" onClick={() => setPaying(true)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
              <Check size={14} /> Accept &amp; pay {eur(amount)}
            </button>
          </div>
        )}
        {quote.appointment_requested_at && !committed && (
          <p className="text-center text-[11px]" style={{ color: "var(--text-faint)" }}>Appointment requested — the team will reach out.</p>
        )}
      </div>
    </>
  );
}

function ApptPanel({ quoteId, onDone, onCancel }: { quoteId: string; onDone: () => void; onCancel: () => void }) {
  const sb = useRef(createClient()).current;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await sb.rpc("request_quote_appointment", { _id: quoteId, _note: note.trim() || null }); onDone(); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Ask to talk it through with your engineer + supervisor before committing.</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What would you like to discuss?" className="rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-full px-3 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />} Request</button>
      </div>
    </div>
  );
}

function PayPanel({ quoteId, amount, onPaid, onCancel }: { quoteId: string; amount: number; onPaid: () => void; onCancel: () => void }) {
  const { theme } = useTheme();
  const sp = stripePromise();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [pi, setPi] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/contract/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId }) });
        const j = (await res.json()) as { clientSecret?: string; paymentIntentId?: string; error?: string };
        if (!alive) return;
        if (!res.ok || !j.clientSecret) throw new Error(j.error ?? "Couldn't start checkout.");
        setClientSecret(j.clientSecret); setPi(j.paymentIntentId ?? null);
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : "Checkout failed."); }
    })();
    return () => { alive = false; };
  }, [quoteId]);
  const appearance = useMemo(() => buildStripeAppearance(), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: "color-mix(in srgb, var(--risk) 30%, transparent)", color: "var(--risk)" }}>{err}</div>;
  if (!clientSecret || !sp || !pi) return <div className="flex items-center gap-2 py-4 text-[13px]" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="animate-spin" /> Preparing secure checkout…</div>;
  return (
    <Elements key={theme} stripe={sp} options={{ clientSecret, appearance }}>
      <PayForm quoteId={quoteId} paymentIntentId={pi} amount={amount} onPaid={onPaid} onCancel={onCancel} />
    </Elements>
  );
}

function PayForm({ quoteId, paymentIntentId, amount, onPaid, onCancel }: { quoteId: string; paymentIntentId: string; amount: number; onPaid: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pay = async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true); setErr(null);
    const { error } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setErr(error.message ?? "Payment failed."); setBusy(false); return; }
    try {
      const res = await fetch("/api/contract/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId, paymentIntentId }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Payment took but committing failed — contact support.");
      onPaid();
    } catch (e) { setErr(e instanceof Error ? e.message : "Commit failed."); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <PaymentElement options={{ layout: { type: "tabs", defaultCollapsed: false } }} />
      {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>Cancel</button>
        <button type="button" onClick={() => void pay()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Pay {eur(amount)} & commit
        </button>
      </div>
    </div>
  );
}
