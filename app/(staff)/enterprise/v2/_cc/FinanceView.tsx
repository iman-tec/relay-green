"use client";

/*
 * Enterprise Finance tab — in-console revenue + session feedback. Replaces the
 * legacy `/finance` link-out that ejected the admin into StaffShell (a foreign,
 * hardcoded-hex card stack). Console-native: KpiRibbon revenue + a token-styled
 * feedback list, matching Overview / Members / Usage.
 *
 * Reuses the exact endpoints the legacy FinanceClient used:
 *   - /api/enterprise/billing      → revenue (this month / 30d / lifetime + rate)
 *   - /api/internal/feedback?limit  → AI sentiment per recent session
 */

import { useEffect, useState } from "react";
import { KpiRibbon, type Kpi } from "@/app/_components/portal/KpiRibbon";
import { eur, int } from "@/app/_components/portal/format";

type Billing = {
  currency: string;
  revenue: {
    thisMonthCents: number;
    last30DaysCents: number;
    lifetimeCents: number;
    perMinuteCents: number;
  };
};

type UsageRow = {
  period: string;
  minutes: number;
  sessions: number;
  spendCents: number;
  suppressed?: boolean;
  suppressedLabel?: string;
};

type Feedback = {
  sessionId: string;
  score: number;
  summary: string;
  computedAt: string;
  customerName: string;
  engineerName: string;
};

function tone(score: number): { color: string; label: string } {
  if (score >= 0.25) return { color: "var(--ok)", label: "Positive" };
  if (score >= -0.1) return { color: "var(--warn)", label: "Neutral" };
  return { color: "var(--risk)", label: "Negative" };
}

export function FinanceView() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback[] | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/billing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!off && b && !b.error) setBilling(b as Billing);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!off) setUsage((d?.byPeriod ?? []) as UsageRow[]);
      })
      .catch(() => {
        if (!off) setUsage([]);
      });
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    let off = false;
    fetch("/api/internal/feedback?limit=40", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { feedback: [] }))
      .then((d) => {
        if (!off) setFeedback((d?.feedback ?? []) as Feedback[]);
      })
      .catch(() => {
        if (!off) setFeedback([]);
      });
    return () => {
      off = true;
    };
  }, []);

  const ribbon: Kpi[] = billing
    ? [
        {
          label: "This month",
          value: eur(billing.revenue.thisMonthCents),
          anchor: true,
          sub: `${eur(billing.revenue.perMinuteCents)}/min rate`,
        },
        { label: "Last 30 days", value: eur(billing.revenue.last30DaysCents) },
        { label: "Lifetime", value: eur(billing.revenue.lifetimeCents) },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <div className="mb-7">
        <h1
          className="font-serif text-[22px] font-semibold"
          style={{ letterSpacing: "-0.01em" }}
        >
          Finance
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Revenue earned from your members&apos; call minutes, and how customers
          felt about each session.
        </p>
      </div>

      {/* Revenue */}
      {billing === null ? (
        <RibbonSkeleton />
      ) : (
        <div className="mb-10">
          <KpiRibbon items={ribbon} />
        </div>
      )}

      {/* Usage — month-by-month consumption */}
      <div
        className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text)" }}
      >
        Usage
      </div>
      {usage === null ? (
        <ListSkeleton />
      ) : usage.length === 0 ? (
        <p className="mb-10 text-[14px]" style={{ color: "var(--text-muted)" }}>
          No usage in the reporting window yet.
        </p>
      ) : (
        <table className="mb-10 w-full border-collapse">
          <thead>
            <tr>
              {(
                [
                  ["Month", "left"],
                  ["Sessions", "right"],
                  ["Minutes", "right"],
                  ["Spend", "right"],
                ] as const
              ).map(([h, a]) => (
                <th
                  key={h}
                  className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
                  style={{
                    color: "var(--text-muted)",
                    textAlign: a,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {usage.map((r) => (
              <tr
                key={r.period}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-4 py-3 text-[14px]">{r.period}</td>
                {r.suppressed ? (
                  <td
                    colSpan={3}
                    className="px-4 py-3 text-right text-[13px]"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {r.suppressedLabel ?? "Insufficient data"}
                  </td>
                ) : (
                  <>
                    <UNum>{int(r.sessions)}</UNum>
                    <UNum>{int(r.minutes)}</UNum>
                    <UNum>{eur(r.spendCents)}</UNum>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Feedback */}
      <div className="mb-3 flex items-baseline justify-between">
        <span
          className="text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Feedback
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>
          AI-derived sentiment per session
        </span>
      </div>

      {feedback === null ? (
        <ListSkeleton />
      ) : feedback.length === 0 ? (
        <div
          className="rounded-lg border border-dashed px-8 py-14 text-center"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <p
            className="text-[15px] font-medium"
            style={{ color: "var(--text)" }}
          >
            No session feedback yet
          </p>
          <p
            className="mx-auto mt-1.5 max-w-sm text-[14px]"
            style={{ color: "var(--text-muted)" }}
          >
            Once your members complete calls, sentiment summaries land here.
          </p>
        </div>
      ) : (
        <ul>
          {feedback.map((f) => {
            const t = tone(f.score);
            return (
              <li
                key={`${f.sessionId}-${f.computedAt}`}
                className="flex items-start gap-3 border-b py-3.5"
                style={{ borderColor: "var(--border)" }}
              >
                <span
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap"
                  style={{ color: "var(--text-muted)" }}
                  title={`Sentiment score ${f.score.toFixed(2)}`}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: t.color }}
                  />
                  {t.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px]" style={{ color: "var(--text)" }}>
                    {f.summary}
                  </div>
                  <div
                    className="mt-0.5 text-[12px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {f.customerName} ↔ {f.engineerName} ·{" "}
                    {new Date(f.computedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
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

function UNum({ children }: { children: React.ReactNode }) {
  return (
    <td
      className="px-4 py-3 text-right font-mono text-[14px] tabular-nums"
      style={{ color: "var(--text)" }}
    >
      {children}
    </td>
  );
}

function RibbonSkeleton() {
  return (
    <div className="mb-10 flex gap-14">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div
            className="mb-2 h-3 w-20 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
          <div
            className="h-7 w-24 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[52px] border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mt-4 h-4 w-64 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}
