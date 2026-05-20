"use client";

/*
 * Finance console — single page for Internal Admin (ops_manager) and
 * Enterprise Admin. Three stacked sections:
 *
 *   1. Revenue strip — this-month / last-30d / lifetime, reused from
 *      /api/enterprise/billing.
 *   2. Salaries table — editable monthly compensation per staff member,
 *      backed by /api/internal/compensation.
 *   3. Feedback feed — latest session_health summaries (sentiment + one
 *      line) from /api/internal/feedback.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Wallet, Pencil, Check, X, MessageSquare } from "lucide-react";
import { formatEur } from "@/lib/billing/plans";
import { formatRole } from "@/lib/relay/role-labels";

const BRAND_GREEN      = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.10)";
const URGENT_AMBER     = "#d4a017";
const CRIT_RED         = "#8b1a1a";

type BillingResponse = {
  currency: string;
  revenue: {
    thisMonthCents:  number;
    last30DaysCents: number;
    lifetimeCents:   number;
    perMinuteCents:  number;
  };
};

type CompRow = {
  userId:        string;
  displayName:   string;
  email:         string;
  role:          string;
  monthlyCents:  number;
  updatedAt:     string | null;
};

type FeedbackRow = {
  sessionId:    string;
  score:        number;
  summary:      string;
  computedAt:   string;
  customerName: string;
  engineerName: string;
};

export function FinanceClient() {
  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>Finance</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Money in, money out, and how customers felt.
        </p>
      </div>
      <RevenueSection />
      {/* Salaries section deliberately disabled — not in scope for the
          current product slice. Re-enable by uncommenting; the
          SalariesSection component + /api/internal/compensation route
          are still wired and ready. */}
      {/* <SalariesSection /> */}
      <FeedbackSection />
    </div>
  );
}

/* ──────── Revenue ──────── */

function RevenueSection() {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/enterprise/billing", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (body && !body.error) setData(body as BillingResponse);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div
        className="flex justify-center rounded-xl border py-10"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <Loader2 size={16} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }
  if (!data) return null;

  const rateEur = data.revenue.perMinuteCents / 100;
  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Wallet size={14} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Revenue</h2>
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Earned from customer call minutes · €{rateEur}/min
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x" style={{ borderColor: "var(--border)" }}>
        <RevenueTile label="This month"   cents={data.revenue.thisMonthCents}  />
        <RevenueTile label="Last 30 days" cents={data.revenue.last30DaysCents} />
        <RevenueTile label="Lifetime"     cents={data.revenue.lifetimeCents}   />
      </div>
    </div>
  );
}

function RevenueTile({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div
        className="mt-1 text-xl font-semibold tabular-nums"
        style={{ color: "var(--text)", fontFeatureSettings: "'tnum' 1" }}
      >
        {formatEur(cents)}
      </div>
    </div>
  );
}

/* ──────── Salaries ──────── */

function SalariesSection() {
  const [staff, setStaff]     = useState<CompRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState<string>("");
  const [busy, setBusy]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/internal/compensation", { cache: "no-store" });
    const body = await res.json().catch(() => ({ staff: [] }));
    setStaff((body.staff ?? []) as CompRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalCents = useMemo(
    () => staff.reduce((acc, s) => acc + (s.monthlyCents || 0), 0),
    [staff],
  );

  const startEdit = (row: CompRow) => {
    setEditing(row.userId);
    setDraft(((row.monthlyCents || 0) / 100).toFixed(2));
  };

  const cancelEdit = () => { setEditing(null); setDraft(""); };

  const save = async (userId: string) => {
    const euros = parseFloat(draft);
    if (!Number.isFinite(euros) || euros < 0) {
      alert("Enter a non-negative number.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/internal/compensation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, monthlyCents: Math.round(euros * 100) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Save failed.");
      cancelEdit();
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Salaries</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Monthly compensation per staff member. Click the pencil to edit.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            Monthly outlay
          </div>
          <div
            className="text-sm font-semibold tabular-nums"
            style={{ color: "var(--text)", fontFeatureSettings: "'tnum' 1" }}
          >
            {formatEur(totalCents)}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : staff.length === 0 ? (
        <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No payroll-eligible staff in this org yet.
        </p>
      ) : (
        <ul>
          {staff.map((s) => {
            const isEditing = editing === s.userId;
            return (
              <li
                key={s.userId}
                className="flex items-center gap-3 border-t px-5 py-3"
                style={{ borderColor: "var(--border)" }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                    color: "var(--text-muted)",
                  }}
                >
                  {(s.displayName || s.email || "?")[0]}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm" style={{ color: "var(--text)" }}>{s.displayName}</div>
                  <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {s.email || "—"} · {formatRole(s.role)}
                  </div>
                </div>
                {isEditing ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>€</span>
                    <input
                      autoFocus
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void save(s.userId);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="w-28 rounded-md border px-2 py-1 text-xs outline-none"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--background)",
                        color: "var(--text)",
                      }}
                    />
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>/mo</span>
                    <button
                      onClick={() => void save(s.userId)}
                      disabled={busy}
                      className="inline-flex items-center rounded-md px-1.5 py-1"
                      style={{ color: BRAND_GREEN }}
                      title="Save"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={busy}
                      className="inline-flex items-center rounded-md px-1.5 py-1"
                      style={{ color: "var(--text-muted)" }}
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: "var(--text)", fontFeatureSettings: "'tnum' 1" }}
                    >
                      {formatEur(s.monthlyCents)}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>/mo</span>
                    <button
                      onClick={() => startEdit(s)}
                      className="rounded-md p-1 transition-opacity hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                      title="Edit salary"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ──────── Feedback ──────── */

function FeedbackSection() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/internal/feedback?limit=40", { cache: "no-store" });
      const body = await res.json().catch(() => ({ feedback: [] }));
      setFeedback((body.feedback ?? []) as FeedbackRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div
      className="rounded-xl border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <MessageSquare size={14} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Feedback</h2>
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          AI-derived sentiment per session
        </span>
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={14} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : feedback.length === 0 ? (
        <p className="px-5 py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          No session feedback yet. Once your engineers complete calls, sentiment summaries will land here.
        </p>
      ) : (
        <ul>
          {feedback.map((f) => {
            const tone = sentimentTone(f.score);
            return (
              <li
                key={`${f.sessionId}-${f.computedAt}`}
                className="flex items-start gap-3 border-t px-5 py-3"
                style={{ borderColor: "var(--border)" }}
              >
                <span
                  className="mt-1 inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold tabular-nums"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${tone.color} 14%, transparent)`,
                    color: tone.color,
                  }}
                  title={`Sentiment score ${f.score.toFixed(2)}`}
                >
                  {tone.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm" style={{ color: "var(--text)" }}>{f.summary}</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {f.customerName} ↔ {f.engineerName} · {new Date(f.computedAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function sentimentTone(score: number): { color: string; label: string } {
  if (score >= 0.25) return { color: BRAND_GREEN,  label: "Positive" };
  if (score >= -0.1) return { color: URGENT_AMBER, label: "Neutral"  };
  return                    { color: CRIT_RED,     label: "Negative" };
}
