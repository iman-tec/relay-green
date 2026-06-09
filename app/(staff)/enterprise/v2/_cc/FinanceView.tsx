"use client";

/*
 * Enterprise Finance tab — in-console revenue + month-by-month usage. Metadata
 * only (no session content / sentiment). Console-native: KpiRibbon revenue + a
 * usage table, matching Overview / Members.
 *
 * Reuses existing endpoints:
 *   - /api/enterprise/billing → revenue (this month / 30d / lifetime + rate)
 *   - /api/enterprise/usage   → per-month sessions / minutes / spend
 */

import { useCallback, useEffect, useState } from "react";
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

export function FinanceView() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/enterprise/billing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b && !b.error) setBilling(b as Billing);
      })
      .catch(() => {});
    fetch("/api/enterprise/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUsage((d?.byPeriod ?? []) as UsageRow[]))
      .catch(() => setUsage([]));
  }, []);

  // Poll so revenue + usage stay current without a manual refresh.
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

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
          Revenue and usage across your members&apos; call minutes.
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
