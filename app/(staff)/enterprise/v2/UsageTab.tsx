"use client";

/*
 * Usage & Reporting — per-department + per-period usage with k-anonymity
 * suppression (server-side, /api/enterprise/usage). Suppressed figures show
 * "Insufficient data to display" instead of a re-identifying breakdown. CSV
 * export omits suppressed rows.
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
} from "./_shared";

type DeptUsage = {
  departmentId: string;
  name: string;
  status: string;
  memberCount: number;
  suppressed: boolean;
  usage: {
    usedMinutes: number;
    allocatedMinutes: number;
    spendCents: number;
  } | null;
  suppressedLabel: string | null;
};
type PeriodUsage = {
  period: string;
  memberCount: number;
  suppressed: boolean;
  minutes: number | null;
  sessions: number | null;
  spendCents: number | null;
  suppressedLabel: string | null;
};
type UsageResp = {
  byDepartment: DeptUsage[];
  byPeriod: PeriodUsage[];
  perMinuteCents: number;
};

export function UsageTab() {
  const { data, loading, error, reload } = useApiData<UsageResp>(
    "/api/enterprise/usage"
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

  const byDept = data?.byDepartment ?? [];
  const byPeriod = data?.byPeriod ?? [];
  const maxMinutes = Math.max(1, ...byPeriod.map((p) => p.minutes ?? 0));

  const exportCsv = () => {
    const lines = [
      "Department,Members,Used minutes,Allocated minutes,Spend (EUR)",
    ];
    for (const d of byDept) {
      if (d.suppressed || !d.usage) {
        lines.push(
          `"${d.name}",${d.memberCount},(suppressed),(suppressed),(suppressed)`
        );
      } else {
        lines.push(
          `"${d.name}",${d.memberCount},${d.usage.usedMinutes},${d.usage.allocatedMinutes},${(d.usage.spendCents / 100).toFixed(2)}`
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relay-usage.csv";
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
            Aggregates only. Groups under the privacy threshold are suppressed.
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

      {/* By period */}
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
          <div className="flex items-end gap-3 overflow-x-auto px-4 py-6">
            {byPeriod.map((p) => {
              const h =
                p.minutes != null
                  ? Math.max(4, Math.round((p.minutes / maxMinutes) * 120))
                  : 8;
              return (
                <div
                  key={p.period}
                  className="flex min-w-[48px] flex-col items-center gap-2"
                >
                  <div
                    className="flex h-[120px] items-end"
                    title={
                      p.suppressed ? (p.suppressedLabel ?? "") : `${p.minutes}m`
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
        )}
      </section>

      {/* By department */}
      <section
        className="mt-6 rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <header
          className="border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            Usage by department
          </h2>
        </header>
        {byDept.length === 0 ? (
          <div className="p-6">
            <EmptyState
              compact
              title="No departments"
              body="Create departments to see per-team usage."
            />
          </div>
        ) : (
          <ul>
            {byDept.map((d) => (
              <li
                key={d.departmentId}
                className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-sm"
                    style={{ color: "var(--text)" }}
                  >
                    {d.name}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {num(d.memberCount)} members
                  </div>
                </div>
                {d.suppressed || !d.usage ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs italic"
                    style={{ color: "var(--text-faint)" }}
                  >
                    <EyeOff size={12} />{" "}
                    {d.suppressedLabel ?? "Insufficient data to display"}
                  </span>
                ) : (
                  <span
                    className="text-sm tabular-nums"
                    style={{ color: "var(--text)" }}
                  >
                    {num(d.usage.usedMinutes)}m · {eur(d.usage.spendCents)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </TabBody>
  );
}
