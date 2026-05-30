"use client";

/*
 * Left-rail "act now" queue — the supervisor's front door to urgent work.
 *   1. Estimation requests (go-live / maintain) — pinned top, the Job-3 trigger.
 *   2. Callback queue — customers waiting on a Busy/Offline engineer, with age
 *      and an SLA-breach (>30 min) flag.
 *
 * Read feed (acting on an estimation request → dive-in/proposal lands in a
 * later step). Realtime on project_quote_requests + engineer_connect_requests,
 * 5s poll fallback, 1s tick for ages.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Loader2, Rocket, Wrench, PhoneCall, AlertTriangle, Inbox, Eye, Check, FileText, Repeat, CalendarClock, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { cn } from "@/app/_components/ui";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";

type Sentiment = { score: number; summary: string; messageCount: number };
type Estimation = { id: string; kind: "golive" | "maintain" | string; status: string; customer: string; project: string; projectId: string; comments: string | null; amountCents: number | null; bidScope: string | null; bidTimeline: string | null; appointmentRequestedAt: string | null; appointmentNote: string | null; changeRequestNote: string | null; createdAt: string; liveSessionId: string | null; liveSentiment: Sentiment | null };
type Callback = { id: string; customer: string; engineer: string; project: string | null; message: string | null; createdAt: string; slaBreached: boolean };
type Escalation = { id: string; sessionId: string; engineer: string; customer: string; reason: string; note: string | null; createdAt: string };
type Feed = { estimationRequests: Estimation[]; callbackQueue: Callback[]; escalations: Escalation[] };

// Estimation-queue categorisation — identical buckets + colours to the
// engineer's Quote-requests inbox (QuoteRequestsInbox) so a bid is triaged
// the same wherever it's seen. Appointment trumps pending/quoted: once the
// customer asks to talk, the row leaves the routine pools so it isn't
// double-counted and the appointment signal isn't lost in queue noise.
// 'review' = an engineer-prepared bid (status 'pending_review') sitting in the
// supervisor's approval queue — not yet visible to the customer. The supervisor
// reviews/edits and sends it, which flips it to 'quoted' (Bid sent).
type Category = "appointment" | "needs_bid" | "review" | "bid_sent" | "accepted";

function categorizeEst(q: Estimation): Category {
  // 'committed' (accepted) is terminal — wins over the appointment overlay so
  // an accepted bid moves out of Appointment and into Accepted.
  if (q.status === "committed") return "accepted";
  if (q.appointmentRequestedAt) return "appointment";
  if (q.status === "pending") return "needs_bid";
  if (q.status === "pending_review") return "review";
  return "bid_sent"; // quoted, no appointment
}

const CATEGORY_META: Record<Category, { label: string; fill: string; fgVar: string }> = {
  appointment: { label: "Appointment", fill: "var(--primary-hover)", fgVar: "var(--primary-hover)" },
  needs_bid:   { label: "Needs bid",   fill: "var(--warn)",          fgVar: "var(--warn)" },
  review:      { label: "Review",      fill: "#6366f1",              fgVar: "#6366f1" },
  bid_sent:    { label: "Bid sent",    fill: "var(--ok)",            fgVar: "var(--ok)" },
  accepted:    { label: "Accepted",    fill: "#3f5c2e",              fgVar: "#3f5c2e" },
};

const FILTER_ORDER: Category[] = ["appointment", "needs_bid", "review", "bid_sent", "accepted"];

export function ActNowRail() {
  const [feed, setFeed] = useState<Feed>({ estimationRequests: [], callbackQueue: [], escalations: [] });
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/act-now", { cache: "no-store" });
      if (res.ok) setFeed((await res.json()) as Feed);
    } catch {
      // Transient network/HMR blip ("Failed to fetch") — realtime + the 5s
      // poll fallback retry. Swallow so it doesn't flood as unhandledRejection.
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const sb = supabaseRef.current;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const queue = () => { if (!pending) pending = setTimeout(() => { pending = null; void refresh(); }, 600); };
    const ch = sb
      .channel("relay-act-now")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_quote_requests" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "engineer_connect_requests" }, queue)
      .subscribe();
    channelRef.current = ch;
    const fallback = setInterval(() => { void refresh(); }, 5_000);
    return () => { if (pending) clearTimeout(pending); sb.removeChannel(ch); channelRef.current = null; clearInterval(fallback); };
  }, [refresh]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  // null = show all; otherwise filter the estimation queue to one bucket.
  const [estFilter, setEstFilter] = useState<Category | null>(null);
  const [engineers, setEngineers] = useState<{ userId: string; displayName: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/supervisor/team", { cache: "no-store" });
        if (res.ok) setEngineers((((await res.json()) as { engineers?: { userId: string; displayName: string }[] }).engineers ?? []).map((e) => ({ userId: e.userId, displayName: e.displayName })));
      } catch { /* ignore */ }
    })();
  }, []);

  const reassign = useCallback(async (id: string, engineerId: string) => {
    await supabaseRef.current.rpc("reassign_connect_request", { _id: id, _new_engineer_user_id: engineerId });
    void refresh();
  }, [refresh]);

  const estCounts = useMemo(() => {
    const c: Record<Category, number> = { appointment: 0, needs_bid: 0, review: 0, bid_sent: 0, accepted: 0 };
    for (const q of feed.estimationRequests) c[categorizeEst(q)]++;
    return c;
  }, [feed.estimationRequests]);
  const visibleEstimations = useMemo(
    () => (estFilter ? feed.estimationRequests.filter((q) => categorizeEst(q) === estFilter) : feed.estimationRequests),
    [feed.estimationRequests, estFilter],
  );

  const breaches = feed.callbackQueue.filter((c) => c.slaBreached).length;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Act now</h2>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>
      ) : (
        <>
          {/* Estimation requests — pinned top, loud. Filter chips mirror the
              engineer's Quote-requests inbox for cross-surface consistency. */}
          <Section title="Estimation requests" count={feed.estimationRequests.length} accent="var(--primary)">
            {feed.estimationRequests.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTER_ORDER.map((cat) => (
                  <FilterChip
                    key={cat}
                    cat={cat}
                    count={estCounts[cat]}
                    active={estFilter === cat}
                    onClick={() => setEstFilter((prev) => (prev === cat ? null : cat))}
                  />
                ))}
              </div>
            )}
            {feed.estimationRequests.length === 0 ? (
              <Empty body="No go-live or maintenance estimates waiting." />
            ) : visibleEstimations.length === 0 ? (
              <Empty body={`No ${CATEGORY_META[estFilter as Category].label.toLowerCase()} requests.`} />
            ) : visibleEstimations.map((q) => (
              <EstimationRow
                key={q.id}
                q={q}
                expanded={expandedId === q.id}
                onToggle={() => setExpandedId((cur) => (cur === q.id ? null : q.id))}
                onDone={() => { setExpandedId(null); void refresh(); }}
              />
            ))}
          </Section>

          {/* Callback queue */}
          <Section title="Callback queue" count={feed.callbackQueue.length}
            accent={breaches > 0 ? "var(--risk)" : "var(--warn)"}
            badge={breaches > 0 ? `${breaches} SLA` : undefined}>
            {feed.callbackQueue.length === 0 ? (
              <Empty body="No customers waiting on an engineer." />
            ) : feed.callbackQueue.map((c) => <CallbackRow key={c.id} c={c} engineers={engineers} onReassign={reassign} />)}
          </Section>
        </>
      )}
    </div>
  );
}

// ── Job-3 dive-in: scope a live/maintain estimate, issue a proposal w/ T&C.
// Expands inline inside the estimation row (left rail) so it stays aligned with
// the queue rather than floating over the live-operations grid. ──
function DiveInForm({ q, onClose, onDone }: { q: Estimation; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [amount, setAmount] = useState(q.amountCents != null ? String(q.amountCents / 100) : "");
  const [scope, setScope] = useState(q.bidScope ?? "");
  const [timeline, setTimeline] = useState(q.bidTimeline ?? "");
  const [validity, setValidity] = useState("30");
  const [termsUrl, setTermsUrl] = useState("/legal/contracting-terms");
  const [showAi, setShowAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const s = q.liveSentiment;
  const tone = !s || s.messageCount < 2 ? null : s.score >= 0.3 ? "var(--ok)" : s.score > -0.3 ? "var(--warn)" : "var(--risk)";
  const isQuoted = q.status === "quoted";
  // Engineer-prepared bid awaiting this supervisor's approval. Gated on the
  // CATEGORY, not the raw status: an appointment overrides the review bucket
  // (appointment takes precedence in categorizeEst), so a row showing
  // "Appointment" must NOT show the "awaiting your review" banner even if its
  // underlying status is still 'pending_review'.
  const isReview = categorizeEst(q) === "review";
  // Accepted/paid bids are terminal — show the bid read-only. The supervisor
  // can't re-send a committed bid (submit_project_bid rejects it anyway), so we
  // disable the inputs and hide the send action.
  const isAccepted = q.status === "committed";

  const submit = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setErr("Enter a valid amount."); return; }
    setBusy(true); setErr(null);
    try {
      // Same rich bid the engineer sends — supervisor reviews/adjusts here.
      const { error } = await supabase.rpc("submit_project_bid", {
        _id: q.id, _amount_cents: cents, _scope: scope.trim() || null, _timeline: timeline.trim() || null,
        _validity_days: Number(validity) || 0, _terms_url: termsUrl.trim() || null,
      });
      if (error) throw new Error(error.message);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the bid."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-start gap-2">
          {q.kind === "golive" ? <Rocket size={18} style={{ color: "var(--primary-hover)" }} /> : <Wrench size={18} style={{ color: "var(--primary-hover)" }} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              Scope {q.kind === "golive" ? "go-live" : "maintenance"} estimate
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{q.project} · {q.customer}</p>
          </div>
        </div>

        {q.comments && (
          <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            “{q.comments}”
          </p>
        )}

        {/* Live session temperature + monitor jump */}
        {q.liveSessionId && (
          <div className="flex items-center gap-2">
            {tone && s ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
                style={{ borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 10%, transparent)`, color: tone }}
                title={s.summary}>
                <span className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
                {s.score >= 0.3 ? "Positive" : s.score > -0.3 ? "Neutral" : "Negative"}
              </span>
            ) : (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Live session · sentiment warming up</span>
            )}
            <button type="button" onClick={() => router.push(`/staff/session/${q.liveSessionId}`)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              <Eye size={11} /> Watch session
            </button>
          </div>
        )}

        {/* Customer asked to talk before committing. */}
        {q.appointmentRequestedAt && (
          <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--primary)", background: "var(--primary-tint)", color: "var(--text)" }}>
            <CalendarClock size={12} className="mr-1 inline" /> Customer requested an appointment{q.appointmentNote ? `: "${q.appointmentNote}"` : "."}
          </div>
        )}

        {/* Review the project's AI history before scoping — collapsed by default
            so the bid form stays the primary content (the assistant is a tall
            full-height panel). Height-bounded + scrolls internally when open. */}
        <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <button type="button" onClick={() => setShowAi((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <FileText size={12} /> Review project history (AI)
            <ChevronDown size={13} className={cn("ml-auto transition-transform", showAi && "rotate-180")} />
          </button>
          {showAi && <div className="h-72 overflow-hidden border-t" style={{ borderColor: "var(--border)" }}><ProjectAIAssistant projectId={q.projectId} /></div>}
        </div>

        {/* Bid — same one-page bid the engineer prepares. */}
        <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <FileText size={12} /> {isAccepted ? "Bid (accepted — read-only)" : isReview ? "Bid (engineer-prepared — review & send)" : isQuoted ? "Bid (sent — adjust & resend)" : "Bid"}
          </div>
          {isReview && (
            <p className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: "color-mix(in srgb, #6366f1 12%, transparent)", color: "var(--text)" }}>
              <span className="font-semibold" style={{ color: "#6366f1" }}>Awaiting your review.</span> An engineer prepared this bid — adjust if needed, then send it to the customer.
            </p>
          )}
          {isAccepted && (
            <p className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: "color-mix(in srgb, var(--ok) 12%, transparent)", color: "var(--text)" }}>
              <span className="font-semibold" style={{ color: "var(--primary-hover)" }}>Accepted by the customer.</span> The contract is active — this bid is read-only.
            </p>
          )}
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Amount (EUR)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={isAccepted} inputMode="decimal" placeholder="5000"
              className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Scope (what's included)
            <textarea value={scope} onChange={(e) => setScope(e.target.value)} disabled={isAccepted} rows={3}
              className="rounded-lg border p-2 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Timeline
              <input value={timeline} onChange={(e) => setTimeline(e.target.value)} disabled={isAccepted} placeholder="3–4 weeks" className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
            </label>
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>Valid for (days)
              <input value={validity} onChange={(e) => setValidity(e.target.value)} disabled={isAccepted} inputMode="numeric" className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Terms &amp; Conditions link
            <input value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} disabled={isAccepted}
              className="h-10 rounded-lg border px-3 text-sm disabled:opacity-70" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
          </label>
          {err && <p className="text-[12px]" style={{ color: "var(--risk)" }}>{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => !busy && onClose()} disabled={busy}
              className="rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>{isAccepted ? "Close" : "Cancel"}</button>
            {!isAccepted && (
              <button type="button" onClick={() => void submit()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--primary)" }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {isReview ? "Approve & send" : isQuoted ? "Update bid" : "Send bid"}
              </button>
            )}
          </div>
        </div>
    </div>
  );
}

function Section({ title, count, accent, badge, children }: { title: string; count: number; accent: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-1.5 rounded-full" style={{ backgroundColor: accent }} />
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
        <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{count}</span>
        {badge && (
          <span className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: "color-mix(in srgb, var(--risk) 14%, transparent)", color: "var(--risk)" }}>{badge}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function EstimationRow({ q, expanded, onToggle, onDone }: { q: Estimation; expanded: boolean; onToggle: () => void; onDone: () => void }) {
  const golive = q.kind === "golive";
  // Pill mirrors the filter bucket this row belongs to — appointment trumps the
  // raw bid status — so it always matches the chip the supervisor filtered by
  // (an appointment row reads "Appointment" even when its bid is already sent).
  const meta = CATEGORY_META[categorizeEst(q)];
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 7%, transparent)" }}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--primary-hover)" }}>
        {golive ? <Rocket size={12} /> : <Wrench size={12} />}
        {golive ? "Go-live" : "Maintain"}
        <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ background: `color-mix(in srgb, ${meta.fgVar} 16%, transparent)`, color: meta.fgVar }}>
          {meta.label}
        </span>
        <span className="ml-auto font-normal normal-case" style={{ color: "var(--text-muted)" }}>{fmtAgo(q.createdAt)}</span>
      </div>
      <div className="mt-1.5 truncate text-sm font-medium" style={{ color: "var(--text)" }}>{q.project}</div>
      <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{q.customer}</div>
      {q.appointmentRequestedAt && <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--primary-hover)" }}><CalendarClock size={10} /> wants to talk</div>}
      {q.changeRequestNote && (
        <p className="mt-1.5 rounded-md px-2 py-1 text-[11px]" style={{ background: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--text)" }}>
          <span className="font-semibold" style={{ color: "var(--warn)" }}>Changes requested:</span> {q.changeRequestNote}
        </p>
      )}
      {q.comments && <p className="mt-1.5 line-clamp-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{q.comments}</p>}
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-white"
        style={{ background: "var(--primary)" }}>
        {expanded ? "Hide bid"
          : q.status === "pending" ? "Review & bid"
          : q.status === "pending_review" ? "Review & send"
          : q.status === "committed" ? "View bid"
          : "Review bid"}
      </button>
      {expanded && <DiveInForm q={q} onClose={onToggle} onDone={onDone} />}
    </div>
  );
}

function CallbackRow({ c, engineers, onReassign }: { c: Callback; engineers: { userId: string; displayName: string }[]; onReassign: (id: string, engineerId: string) => void }) {
  const [reassigning, setReassigning] = useState(false);
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: c.slaBreached ? "var(--risk)" : "var(--border)", background: c.slaBreached ? "color-mix(in srgb, var(--risk) 8%, transparent)" : "var(--surface)" }}>
      <div className="flex items-center gap-1.5 text-xs">
        <PhoneCall size={12} style={{ color: c.slaBreached ? "var(--risk)" : "var(--warn)" }} />
        <span className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--text)" }}>{c.customer}</span>
        <span className="shrink-0 tabular-nums" style={{ color: c.slaBreached ? "var(--risk)" : "var(--text-muted)" }}>{fmtAgo(c.createdAt)}</span>
      </div>
      <div className="mt-1 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
        waiting on <span style={{ color: "var(--text)" }}>{c.engineer}</span>{c.project ? ` · ${c.project}` : ""}
      </div>
      {c.slaBreached && (
        <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase" style={{ color: "var(--risk)" }}>
          <AlertTriangle size={10} /> SLA breached
        </div>
      )}
      {reassigning ? (
        <select autoFocus defaultValue="" onChange={(e) => { if (e.target.value) onReassign(c.id, e.target.value); setReassigning(false); }}
          onBlur={() => setReassigning(false)}
          className="mt-2 h-8 w-full rounded-md border px-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}>
          <option value="" disabled>Reassign to…</option>
          {engineers.map((eng) => <option key={eng.userId} value={eng.userId}>{eng.displayName}</option>)}
        </select>
      ) : (
        <button type="button" onClick={() => setReassigning(true)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          <Repeat size={11} /> Reassign
        </button>
      )}
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
      <Inbox size={13} /> {body}
    </div>
  );
}

// Pill toggle for the estimation queue — same shape/behaviour as the
// engineer inbox's FilterChip (QuoteRequestsInbox): tap to filter, tap the
// active one again to clear.
function FilterChip({ cat, count, active, onClick }: { cat: Category; count: number; active: boolean; onClick: () => void }) {
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

function fmtAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}
