"use client";

/*
 * Engineer quote/contract queue — incoming go-live / maintenance estimate
 * requests. The engineer reviews the project's AI history (ProjectAIAssistant)
 * and submits a one-page bid (amount + scope + timeline) with the standard
 * T&C attached. Pending = needs a bid; Quoted = bid sent, awaiting the
 * customer. Realtime on project_quote_requests.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Loader2, Rocket, Wrench, X, FileText, CalendarClock, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";

type Req = {
  id: string; kind: "golive" | "maintain" | string; status: string;
  customer: string; project: string; projectId: string; comments: string | null;
  amountCents: number | null; createdAt: string; respondedAt: string | null;
  appointmentRequestedAt: string | null; appointmentNote: string | null;
};

const DEFAULT_TERMS = "/legal/contracting-terms";

export function QuoteRequestsInbox() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [bid, setBid] = useState<Req | null>(null);
  const sbRef = useRef(createClient());
  const chRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/quote-requests", { cache: "no-store" });
      if (res.ok) setRows(((await res.json()) as { requests: Req[] }).requests ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sb = sbRef.current;
    let t: ReturnType<typeof setTimeout> | null = null;
    const q = () => { if (!t) t = setTimeout(() => { t = null; void load(); }, 600); };
    const ch = sb.channel("relay-quote-inbox").on("postgres_changes", { event: "*", schema: "public", table: "project_quote_requests" }, q).subscribe();
    chRef.current = ch;
    const fb = setInterval(() => void load(), 8000);
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch); clearInterval(fb); };
  }, [load]);

  if (loading) return null;
  if (rows.length === 0) return null; // quiet when empty — don't clutter the inbox

  return (
    <section className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <FileText size={15} style={{ color: "var(--primary-hover)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Quote requests</h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{rows.length}</span>
      </header>
      <ul>
        {rows.map((r) => {
          const golive = r.kind === "golive";
          const needsBid = r.status === "pending";
          return (
            <li key={r.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}>
                {golive ? <Rocket size={14} /> : <Wrench size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm" style={{ color: "var(--text)" }}>
                  {r.project} <span style={{ color: "var(--text-faint)" }}>· {r.customer}</span>
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>{golive ? "Go-live" : "Maintain"}</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: needsBid ? "color-mix(in srgb, var(--warn) 16%, transparent)" : "color-mix(in srgb, var(--ok) 16%, transparent)", color: needsBid ? "var(--warn)" : "var(--ok)" }}>
                    {needsBid ? "Needs bid" : "Bid sent"}
                  </span>
                  {r.appointmentRequestedAt && <span className="inline-flex items-center gap-1" style={{ color: "var(--primary-hover)" }}><CalendarClock size={11} /> wants to talk</span>}
                </div>
              </div>
              <button type="button" onClick={() => setBid(r)}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--primary)" }}>
                {needsBid ? "Prepare bid" : "Edit bid"}
              </button>
            </li>
          );
        })}
      </ul>
      {bid && <BidPrepModal req={bid} onClose={() => setBid(null)} onSent={() => { setBid(null); void load(); }} />}
    </section>
  );
}

function BidPrepModal({ req, onClose, onSent }: { req: Req; onClose: () => void; onSent: () => void }) {
  const sb = useRef(createClient()).current;
  const [amount, setAmount] = useState(req.amountCents != null ? String(req.amountCents / 100) : "");
  const [scope, setScope] = useState("");
  const [timeline, setTimeline] = useState("");
  const [validity, setValidity] = useState("30");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setErr("Enter a valid amount."); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await sb.rpc("submit_project_bid", {
        _id: req.id, _amount_cents: cents, _scope: scope.trim() || null, _timeline: timeline.trim() || null,
        _validity_days: Number(validity) || 0, _terms_url: terms.trim() || null,
      });
      if (error) throw new Error(error.message);
      onSent();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the bid."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ backgroundColor: "var(--scrim)" }} onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[61] flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <div className="flex items-start gap-2">
          {req.kind === "golive" ? <Rocket size={18} style={{ color: "var(--primary-hover)" }} /> : <Wrench size={18} style={{ color: "var(--primary-hover)" }} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              Bid · {req.kind === "golive" ? "Go-live" : "Maintain"} — {req.project}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{req.customer}{req.comments ? ` · "${req.comments}"` : ""}</p>
          </div>
          <button type="button" onClick={() => !busy && onClose()} style={{ color: "var(--text-muted)" }}><X size={16} /></button>
        </div>

        {req.appointmentRequestedAt && (
          <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--primary)", background: "var(--primary-tint)", color: "var(--text)" }}>
            <CalendarClock size={12} className="mr-1 inline" /> Customer requested an appointment{req.appointmentNote ? `: "${req.appointmentNote}"` : "."}
          </div>
        )}

        {/* Review the project's AI history before scoping. */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Project history</div>
          <ProjectAIAssistant projectId={req.projectId} />
        </div>

        {/* The one-page bid. */}
        <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><FileText size={12} /> Bid</div>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Amount (EUR)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="5000" className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Scope (what's included)
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={3} className="rounded-lg border p-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Timeline
              <input value={timeline} onChange={(e) => setTimeline(e.target.value)} placeholder="3–4 weeks" className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
            </label>
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Valid for (days)
              <input value={validity} onChange={(e) => setValidity(e.target.value)} inputMode="numeric" className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Terms &amp; Conditions link
            <input value={terms} onChange={(e) => setTerms(e.target.value)} className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => !busy && onClose()} disabled={busy} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>Cancel</button>
            <button type="button" onClick={() => void send()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Send bid
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
