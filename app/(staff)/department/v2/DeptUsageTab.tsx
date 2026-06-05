"use client";

/*
 * Usage & Reporting — department-scoped, per-month with k-anonymity
 * suppression. CSV export omits suppressed months.
 */

import { Download, EyeOff, BarChart3 } from "lucide-react";
import { EmptyState } from "@/app/_components/ui";
import {
  useApiData,
  eur,
  num,
  TabBody,
  LoadingState,
  ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Period = {
  period: string;
  memberCount: number;
  suppressed: boolean;
  minutes: number | null;
  sessions: number | null;
  spendCents: number | null;
  suppressedLabel: string | null;
};

export function DeptUsageTab() {
  const { data, loading, error, reload } = useApiData<{ byPeriod: Period[] }>(
    "/api/department/usage"
  );
  if (loading)
    return (
      <TabBody>
        <LoadingState />
      </TabBody>
    );
  if (error)
    return (
      <TabBody>
        <ErrorState message={error} onRetry={reload} />
      </TabBody>
    );

  const byPeriod = data?.byPeriod ?? [];
  const maxMin = Math.max(1, ...byPeriod.map((p) => p.minutes ?? 0));

  const exportCsv = () => {
    const lines = ["Month,Members,Minutes,Sessions,Spend (EUR)"];
    for (const p of byPeriod) {
      lines.push(
        p.suppressed
          ? `${p.period},${p.memberCount},(suppressed),(suppressed),(suppressed)`
          : `${p.period},${p.memberCount},${p.minutes},${p.sessions},${((p.spendCents ?? 0) / 100).toFixed(2)}`
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "department-usage.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TabBody>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1
            className="font-serif text-2xl font-medium"
            style={{ color: "var(--text)" }}
          >
            Usage & reporting
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Months with too few active members are suppressed for privacy.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-raised)]"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      <section
        className="rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <header
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <BarChart3 size={14} style={{ color: "var(--text-muted)" }} />
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            Usage by month
          </h2>
        </header>
        {byPeriod.length === 0 ? (
          <div className="p-6">
            <EmptyState
              compact
              title="No usage yet"
              body="Monthly usage appears once sessions complete."
            />
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3 overflow-x-auto px-4 py-6">
              {byPeriod.map((p) => {
                const h =
                  p.minutes != null
                    ? Math.max(4, Math.round((p.minutes / maxMin) * 120))
                    : 8;
                return (
                  <div
                    key={p.period}
                    className="flex min-w-[48px] flex-col items-center gap-2"
                  >
                    <div
                      className="flex h-[120px] items-end"
                      title={
                        p.suppressed
                          ? (p.suppressedLabel ?? "")
                          : `${p.minutes}m`
                      }
                    >
                      {p.suppressed ? (
                        <div
                          className="flex h-2 w-8 items-center justify-center rounded"
                          style={{ background: "var(--surface-raised)" }}
                        >
                          <EyeOff
                            size={10}
                            style={{ color: "var(--text-faint)" }}
                          />
                        </div>
                      ) : (
                        <div
                          className="w-8 rounded-t"
                          style={{ height: h, background: "var(--primary)" }}
                        />
                      )}
                    </div>
                    <span
                      className="text-[10px] tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {p.period.slice(2)}
                    </span>
                  </div>
                );
              })}
            </div>
            <ul className="border-t" style={{ borderColor: "var(--border)" }}>
              {byPeriod.map((p) => (
                <li
                  key={p.period}
                  className="flex items-center justify-between border-t px-4 py-2.5 first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="text-sm" style={{ color: "var(--text)" }}>
                    {p.period}
                  </span>
                  {p.suppressed ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs italic"
                      style={{ color: "var(--text-faint)" }}
                    >
                      <EyeOff size={12} /> {p.suppressedLabel}
                    </span>
                  ) : (
                    <span
                      className="text-sm tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {num(p.minutes)}m · {p.sessions} sessions ·{" "}
                      {eur(p.spendCents)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </TabBody>
  );
}
