"use client";

/*
 * Engineer quote/contract queue — incoming go-live / maintenance estimate
 * requests. The engineer reviews the project's AI history (ProjectAIAssistant)
 * and submits a one-page bid (amount + scope + timeline) with the standard
 * T&C attached. Pending = needs a bid; Quoted = bid sent, awaiting the
 * customer. Realtime on project_quote_requests.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Loader2, Rocket, Wrench, X, FileText, CalendarClock, ChevronDown, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";

type Req = {
  id: string; kind: "golive" | "maintain" | string; status: string;
  customer: string; project: string; projectId: string; comments: string | null;
  amountCents: number | null; bidScope: string | null; bidTimeline: string | null;
  bidValidityUntil: string | null; termsUrl: string | null;
  createdAt: string; respondedAt: string | null;
  appointmentRequestedAt: string | null; appointmentNote: string | null;
};

// Mutually-exclusive buckets the engineer filters by. Appointment trumps
// quoted/pending — once the customer asks to talk, the row leaves the
// vanilla "Bid sent" / "Needs bid" pools so it's not double-counted and the
// appointment signal isn't lost amongst routine queue noise.
type Category = "appointment" | "needs_bid" | "in_review" | "bid_sent" | "accepted";

function categorize(r: Req): Category {
  // 'committed' (paid/accepted) is terminal and wins over the appointment
  // overlay — once a customer accepts, the bid belongs in Accepted even if they
  // had earlier requested an appointment.
  if (r.status === "committed") return "accepted";
  if (r.appointmentRequestedAt) return "appointment";
  if (r.status === "pending") return "needs_bid";
  // Bid sent by the engineer but not yet approved by a supervisor — it's NOT
  // with the customer yet, so it gets its own bucket rather than "Bid sent".
  if (r.status === "pending_review") return "in_review";
  return "bid_sent"; // quoted, no appointment
}

const CATEGORY_META: Record<Category, { label: string; fill: string; fgVar: string; bgTint: string }> = {
  appointment: {
    label: "Appointment",
    fill: "var(--primary-hover)",
    fgVar: "var(--primary-hover)",
    bgTint: "color-mix(in srgb, var(--primary-hover) 16%, transparent)",
  },
  needs_bid: {
    label: "Needs bid",
    fill: "var(--warn)",
    fgVar: "var(--warn)",
    bgTint: "color-mix(in srgb, var(--warn) 16%, transparent)",
  },
  in_review: {
    label: "In review",
    fill: "#6366f1",
    fgVar: "#6366f1",
    bgTint: "color-mix(in srgb, #6366f1 16%, transparent)",
  },
  bid_sent: {
    label: "Bid sent",
    fill: "var(--ok)",
    fgVar: "var(--ok)",
    bgTint: "color-mix(in srgb, var(--ok) 16%, transparent)",
  },
  accepted: {
    label: "Accepted",
    fill: "#3f5c2e",
    fgVar: "#3f5c2e",
    bgTint: "color-mix(in srgb, #3f5c2e 18%, transparent)",
  },
};

const FILTER_ORDER: Category[] = ["appointment", "needs_bid", "in_review", "bid_sent", "accepted"];

const DEFAULT_TERMS = "/legal/contracting-terms";

// Compact "2d ago" / "3h ago" relative time for the row metadata column.
function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function fmtAmount(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function QuoteRequestsInbox() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [bid, setBid] = useState<Req | null>(null);
  // null = "show all"; otherwise filter to that single bucket.
  const [filter, setFilter] = useState<Category | null>(null);
  // Per-row appointment-note expansion. Set membership = expanded.
  // Multiple rows can be expanded at once; click the capsule again to
  // collapse. State is local-only on purpose — it shouldn't persist
  // across mounts (a fresh visit shows everything collapsed).
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const toggleNote = useCallback((id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
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

  const counts = useMemo(() => {
    const c: Record<Category, number> = { appointment: 0, needs_bid: 0, in_review: 0, bid_sent: 0, accepted: 0 };
    for (const r of rows) c[categorize(r)]++;
    return c;
  }, [rows]);

  const visibleRows = useMemo(
    () => filter ? rows.filter((r) => categorize(r) === filter) : rows,
    [rows, filter],
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {/* Sticky header — title + counts + filter chips. shrink-0 so the
          list area below can claim the rest with flex-1 and scroll
          internally regardless of row count. */}
      <header
        className="shrink-0 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <FileText size={15} style={{ color: "var(--primary-hover)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Quote requests</h2>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{rows.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 pt-2">
          {FILTER_ORDER.map((cat) => (
            <FilterChip
              key={cat}
              cat={cat}
              count={counts[cat]}
              active={filter === cat}
              onClick={() => setFilter((prev) => prev === cat ? null : cat)}
            />
          ))}
        </div>
      </header>

      {/* Scroll area. flex-1 + min-h-0 + overflow-y-auto is the standard
          pattern for "fill remaining vertical space, scroll if content
          overflows" inside a parent flex column. hide-scrollbar (defined
          in globals.css) keeps the wheel/touch scroll working while
          hiding the visible bar — matches the People list and Call log
          treatment elsewhere in the inbox. */}
      <div className="hide-scrollbar flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {loading ? (
          <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</p>
        ) : visibleRows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {rows.length === 0
              ? "No quote requests yet."
              : `No ${CATEGORY_META[filter as Category].label.toLowerCase()} requests.`}
          </p>
        ) : (
          <ul>
            {visibleRows.map((r) => {
              const golive = r.kind === "golive";
              const cat = categorize(r);
              const meta = CATEGORY_META[cat];
              const needsBid = r.status === "pending";
              // Once a bid has left the engineer's hands — sent to the customer
              // (bid_sent), the customer asked to talk (appointment), or it's
              // accepted — the engineer can only VIEW it. They still edit while
              // it Needs bid or is In review (before a supervisor approves it).
              const readOnly = cat === "appointment" || cat === "bid_sent" || cat === "accepted";
              const amount = fmtAmount(r.amountCents);
              const when = relTime(r.respondedAt ?? r.createdAt);
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-black/[0.015] dark:hover:bg-white/[0.02]"
                  style={{ borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)" }}
                >
                  <span
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}
                  >
                    {golive ? <Rocket size={15} /> : <Wrench size={15} />}
                  </span>

                  {/* Identity — grows to fill the row; everything else is a
                      fixed-width column to its right so the queue reads like
                      an aligned table instead of a left-clumped list. */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {r.project} <span style={{ color: "var(--text-faint)" }}>· {r.customer}</span>
                    </div>
                    <div
                      className="mt-0.5 flex min-w-0 items-center gap-2 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="shrink-0">{golive ? "Go-live" : "Maintain"}</span>
                      {/* Appointment note as a fixed-width peek capsule —
                          truncates inline, expands to a full block on click. */}
                      {cat === "appointment" && r.appointmentNote && (
                        <button
                          type="button"
                          onClick={() => toggleNote(r.id)}
                          aria-expanded={expandedNotes.has(r.id)}
                          aria-label={expandedNotes.has(r.id) ? "Collapse customer note" : "Expand customer note"}
                          className="inline-flex max-w-[220px] shrink items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                          style={{
                            color: "var(--primary-hover)",
                            background: "color-mix(in srgb, var(--primary-hover) 7%, transparent)",
                          }}
                        >
                          <MessageCircle size={9} className="shrink-0" />
                          <span className="truncate">{r.appointmentNote}</span>
                          <ChevronDown
                            size={9}
                            className="shrink-0 transition-transform"
                            style={{ transform: expandedNotes.has(r.id) ? "rotate(180deg)" : "none" }}
                          />
                        </button>
                      )}
                    </div>
                    {cat === "appointment" && r.appointmentNote && expandedNotes.has(r.id) && (
                      <p
                        className="mt-1.5 whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-xs"
                        style={{
                          background: "color-mix(in srgb, var(--primary-hover) 6%, transparent)",
                          color: "var(--text)",
                        }}
                      >
                        “{r.appointmentNote}”
                      </p>
                    )}
                  </div>

                  {/* Status — subtle dot + label (no heavy filled pill). */}
                  <div className="hidden w-28 shrink-0 items-center gap-1.5 sm:flex">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: meta.fill }}
                    />
                    <span className="truncate text-[11px] font-medium" style={{ color: meta.fgVar }}>
                      {meta.label}
                    </span>
                  </div>

                  {/* Amount + relative time — fills the empty mid-row space. */}
                  <div className="hidden w-24 shrink-0 flex-col items-end leading-tight md:flex">
                    {amount && (
                      <span className="text-sm tabular-nums" style={{ color: "var(--text)" }}>
                        {amount}
                      </span>
                    )}
                    {when && (
                      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                        {when}
                      </span>
                    )}
                  </div>

                  {/* Action — ghost "View" (read-only) vs solid CTA so the
                      column isn't a wall of green. Fixed width aligns them. */}
                  {readOnly ? (
                    <button
                      type="button"
                      onClick={() => setBid(r)}
                      className="w-24 shrink-0 rounded-md border py-1.5 text-center text-xs font-medium transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                    >
                      View
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBid(r)}
                      className="w-24 shrink-0 rounded-md py-1.5 text-center text-xs font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: "var(--primary)" }}
                    >
                      {needsBid ? "Prepare bid" : "Edit bid"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {bid && <BidPrepModal req={bid} onClose={() => setBid(null)} onSent={() => { setBid(null); void load(); }} />}
    </section>
  );
}

function FilterChip({
  cat, count, active, onClick,
}: {
  cat: Category;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const meta = CATEGORY_META[cat];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors"
      style={{
        background: active ? meta.fill : "transparent",
        color: active ? "#fff" : meta.fgVar,
        borderColor: active ? meta.fill : `color-mix(in srgb, ${meta.fill} 35%, transparent)`,
      }}
    >
      <span>{meta.label}</span>
      <span
        className="rounded-full px-1.5 text-[10px] tabular-nums"
        style={{
          background: active ? "rgba(255,255,255,0.22)" : `color-mix(in srgb, ${meta.fill} 16%, transparent)`,
          color: active ? "#fff" : meta.fgVar,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function BidPrepModal({ req, onClose, onSent }: { req: Req; onClose: () => void; onSent: () => void }) {
  const sb = useRef(createClient()).current;
  // View-only once the bid has left the engineer's hands (sent / appointment /
  // accepted). Editing stays open for Needs bid + In review.
  const cat = categorize(req);
  const readOnly = cat === "appointment" || cat === "bid_sent" || cat === "accepted";
  const [amount, setAmount] = useState(req.amountCents != null ? String(req.amountCents / 100) : "");
  const [scope, setScope] = useState(req.bidScope ?? "");
  const [timeline, setTimeline] = useState(req.bidTimeline ?? "");
  const [validity, setValidity] = useState("30");
  const [terms, setTerms] = useState(req.termsUrl ?? DEFAULT_TERMS);
  const [showAi, setShowAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useOverlayDismiss(onClose);

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
      <div className="fixed inset-0 z-[var(--z-modal)]" style={{ backgroundColor: "var(--scrim)" }} onClick={() => !busy && onClose()} />
      <div ref={dialogRef} role="dialog" aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[var(--z-modal)] flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <div className="flex items-start gap-2">
          {req.kind === "golive" ? <Rocket size={18} style={{ color: "var(--primary-hover)" }} /> : <Wrench size={18} style={{ color: "var(--primary-hover)" }} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              {readOnly ? "View bid" : "Bid"} · {req.kind === "golive" ? "Go-live" : "Maintain"} — {req.project}
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

        {/* Review the project's AI history — collapsed by default so the bid
            form stays primary (assistant is a tall full-height panel). */}
        <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <button type="button" onClick={() => setShowAi((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <FileText size={12} /> Review project history (AI)
            <ChevronDown size={13} className={`ml-auto transition-transform ${showAi ? "rotate-180" : ""}`} />
          </button>
          {showAi && <div className="h-72 overflow-hidden border-t" style={{ borderColor: "var(--border)" }}><ProjectAIAssistant projectId={req.projectId} /></div>}
        </div>

        {/* The one-page bid. */}
        <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}><FileText size={12} /> {readOnly ? "Bid (read-only)" : "Bid"}</div>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Amount (EUR)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={readOnly} inputMode="decimal" placeholder="5000" className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Scope (what&apos;s included)
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} disabled={readOnly} rows={3} className="rounded-lg border p-2 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Timeline
              <input value={timeline} onChange={(e) => setTimeline(e.target.value)} disabled={readOnly} placeholder="3–4 weeks" className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
            </label>
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>{readOnly ? "Valid until" : "Valid for (days)"}
              {readOnly ? (
                <input value={req.bidValidityUntil ? new Date(req.bidValidityUntil).toLocaleDateString() : "—"} disabled className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
              ) : (
                <input value={validity} onChange={(e) => setValidity(e.target.value)} inputMode="numeric" className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
              )}
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Terms &amp; Conditions link
            <input value={terms} onChange={(e) => setTerms(e.target.value)} disabled={readOnly} className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => !busy && onClose()} disabled={busy} className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && (
              <button type="button" onClick={() => void send()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Send bid
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
