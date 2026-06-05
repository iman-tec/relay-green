"use client";

/*
 * Enterprise Dashboard — org-wide overview. Stat cards, recent sessions
 * (PII-minimized: no customer email, no AI summary), top departments by
 * usage. Org-scoped via the /api/enterprise/* endpoints.
 */

import { useState } from "react";
import { Activity, Sparkles, ArrowRight } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import { SetupWizard } from "./SetupWizard";
import { useApiData, eur, num, LoadingState, ErrorState } from "./_shared";
import {
  TabBody, TabTitle, StatCard, CardHeader, PrimaryButton,
  BRAND_GREEN, BRAND_GREEN_SOFT,
} from "./_kit";

type Me = {
  org: { id: string; name: string; status: string };
  kpis: {
    staffCount: number; userCount: number;
    sessions7Days: number; sessions30Days: number;
    activeIn7Days: number; liveNow: number;
    spendMonthCents: number; avgDurationMin: number;
  };
};
type Session = {
  id: string; status: string; urgency: string;
  createdAt: string; durationMinutes: number | null; chargeCents: number | null;
  customerName: string; engineerName: string; projectName: string | null;
};
type Dept = {
  id: string; name: string; status: string;
  usedMinutes: number; allocatedMinutes: number; totalEmployees: number;
};

const STATUS_TONE: Record<string, "ok" | "warn" | "risk" | "neutral" | "info"> = {
  live: "ok", joining: "ok", assigned: "info", queued: "warn",
  ended: "neutral", cancelled: "risk", abandoned: "risk", grace: "warn",
};

export function DashboardTab() {
  const me = useApiData<Me>("/api/enterprise/me");
  const sessions = useApiData<{ sessions: Session[] }>("/api/enterprise/sessions?limit=8");
  const depts = useApiData<{ departments: Dept[] }>("/api/enterprise/departments");
  const [wizardOpen, setWizardOpen] = useState(false);

  if (me.loading) return <TabBody><LoadingState /></TabBody>;
  if (me.error) return <TabBody><ErrorState message={me.error} onRetry={me.reload} /></TabBody>;
  const k = me.data?.kpis;

  const deptList = depts.data?.departments ?? [];
  const topDepts = [...deptList].sort((a, b) => b.usedMinutes - a.usedMinutes).slice(0, 5);
  // Fresh org: nothing set up yet → nudge the setup wizard.
  const needsSetup = !depts.loading && deptList.length === 0 && (k?.userCount ?? 0) === 0;

  const reloadAll = () => { me.reload(); depts.reload(); };

  return (
    <TabBody>
      <TabTitle
        title={me.data?.org.name ?? "Organization"}
        sub={`Org-wide overview · ${num(k?.userCount)} members · ${num(k?.staffCount)} staff`}
      />

      {needsSetup && (
        <div className="mb-6 flex flex-col items-start gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: BRAND_GREEN, background: BRAND_GREEN_SOFT }}>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-xl" style={{ background: "var(--surface)", color: BRAND_GREEN }}>
              <Sparkles size={18} />
            </span>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>Finish setting up {me.data?.org.name ?? "your workspace"}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Create departments and invite your team — three quick steps.</div>
            </div>
          </div>
          <PrimaryButton icon={<ArrowRight size={14} />} onClick={() => setWizardOpen(true)}>Set up workspace</PrimaryButton>
        </div>
      )}

      <SetupWizard open={wizardOpen} onClose={() => setWizardOpen(false)} orgName={me.data?.org.name ?? "your workspace"} onChanged={reloadAll} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard value={eur(k?.spendMonthCents)} label="Spend this month" accent={BRAND_GREEN} />
        <StatCard value={num(k?.liveNow)} label="Live now" accent="#0ea5e9" />
        <StatCard value={num(k?.sessions30Days)} label="Sessions" hint="last 30 days" accent="#7c3aed" />
        <StatCard value={`${num(k?.avgDurationMin)}m`} label="Avg duration" accent="#16a34a" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent sessions */}
        <section
          className="overflow-hidden rounded-xl border lg:col-span-2"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <CardHeader icon={<Activity size={14} />} title="Recent sessions" />
          {sessions.loading ? (
            <LoadingState />
          ) : (sessions.data?.sessions ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState compact icon={<Activity size={18} />} title="No sessions yet" body="Sessions will appear here as your team uses Relay." />
            </div>
          ) : (
            <ul>
              {(sessions.data?.sessions ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: "var(--text)" }}>
                      {s.customerName || "—"}
                      {s.projectName ? (
                        <span style={{ color: "var(--text-faint)" }}> · {s.projectName}</span>
                      ) : null}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {new Date(s.createdAt).toLocaleDateString()} ·{" "}
                      {s.durationMinutes ? `${s.durationMinutes}m` : "—"} ·{" "}
                      {s.chargeCents != null ? eur(s.chargeCents) : "—"}
                    </div>
                  </div>
                  <StatusBadge compact tone={STATUS_TONE[s.status] ?? "neutral"}>
                    {s.status}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top departments */}
        <section
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <CardHeader title="Top departments" />
          {depts.loading ? (
            <LoadingState />
          ) : topDepts.length === 0 ? (
            <div className="p-6">
              <EmptyState compact title="No departments" body="Create a department to start allocating minutes." />
            </div>
          ) : (
            <ul>
              {topDepts.map((d) => {
                const pct = d.allocatedMinutes > 0
                  ? Math.min(100, Math.round((d.usedMinutes / d.allocatedMinutes) * 100))
                  : 0;
                return (
                  <li
                    key={d.id}
                    className="border-t px-4 py-3 first:border-t-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate text-sm" style={{ color: "var(--text)" }}>{d.name}</span>
                      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {num(d.usedMinutes)}/{num(d.allocatedMinutes)}m
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-raised)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--primary)" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </TabBody>
  );
}
