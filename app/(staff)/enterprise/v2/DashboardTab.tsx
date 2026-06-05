"use client";

/*
 * Enterprise Dashboard — org-wide overview. Stat cards, recent sessions
 * (PII-minimized: no customer email, no AI summary), top departments by
 * usage. Org-scoped via the /api/enterprise/* endpoints.
 */

import { useState } from "react";
import {
  Clock,
  Activity,
  CheckCircle2,
  Timer,
  Radio,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button, StatusBadge, EmptyState } from "@/app/_components/ui";
import { SetupWizard } from "./SetupWizard";
import {
  useApiData,
  eur,
  num,
  TabBody,
  StatCard,
  LoadingState,
  ErrorState,
} from "./_shared";

type Me = {
  org: { id: string; name: string; status: string };
  kpis: {
    staffCount: number;
    userCount: number;
    sessions7Days: number;
    sessions30Days: number;
    activeIn7Days: number;
    liveNow: number;
    spendMonthCents: number;
    avgDurationMin: number;
  };
};
type Session = {
  id: string;
  status: string;
  urgency: string;
  createdAt: string;
  durationMinutes: number | null;
  chargeCents: number | null;
  customerName: string;
  engineerName: string;
  projectName: string | null;
};
type Dept = {
  id: string;
  name: string;
  status: string;
  usedMinutes: number;
  allocatedMinutes: number;
  totalEmployees: number;
};

const STATUS_TONE: Record<string, "ok" | "warn" | "risk" | "neutral" | "info"> =
  {
    live: "ok",
    joining: "ok",
    assigned: "info",
    queued: "warn",
    ended: "neutral",
    cancelled: "risk",
    abandoned: "risk",
    grace: "warn",
  };

export function DashboardTab() {
  const me = useApiData<Me>("/api/enterprise/me");
  const sessions = useApiData<{ sessions: Session[] }>(
    "/api/enterprise/sessions?limit=8"
  );
  const depts = useApiData<{ departments: Dept[] }>(
    "/api/enterprise/departments"
  );
  const [wizardOpen, setWizardOpen] = useState(false);

  if (me.loading)
    return (
      <TabBody>
        <LoadingState />
      </TabBody>
    );
  if (me.error)
    return (
      <TabBody>
        <ErrorState message={me.error} onRetry={me.reload} />
      </TabBody>
    );
  const k = me.data?.kpis;

  const deptList = depts.data?.departments ?? [];
  const topDepts = [...deptList]
    .sort((a, b) => b.usedMinutes - a.usedMinutes)
    .slice(0, 5);
  // Fresh org: nothing set up yet → nudge the setup wizard.
  const needsSetup =
    !depts.loading && deptList.length === 0 && (k?.userCount ?? 0) === 0;

  const reloadAll = () => {
    me.reload();
    depts.reload();
  };

  return (
    <TabBody>
      <h1
        className="mb-1 font-serif text-2xl font-medium"
        style={{ color: "var(--text)" }}
      >
        {me.data?.org.name ?? "Organization"}
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Org-wide overview · {num(k?.userCount)} members · {num(k?.staffCount)}{" "}
        staff
      </p>

      {needsSetup && (
        <div
          className="mb-6 flex flex-col items-start gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between"
          style={{
            borderColor: "var(--primary)",
            background: "var(--primary-tint)",
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="inline-flex size-10 items-center justify-center rounded-xl"
              style={{
                background: "var(--surface)",
                color: "var(--primary-hover)",
              }}
            >
              <Sparkles size={18} />
            </span>
            <div>
              <div
                className="text-sm font-semibold"
                style={{ color: "var(--text)" }}
              >
                Finish setting up {me.data?.org.name ?? "your workspace"}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Create departments and invite your team — three quick steps.
              </div>
            </div>
          </div>
          <Button
            iconLeft={<ArrowRight size={14} />}
            onClick={() => setWizardOpen(true)}
          >
            Set up workspace
          </Button>
        </div>
      )}

      <SetupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        orgName={me.data?.org.name ?? "your workspace"}
        onChanged={reloadAll}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Timer size={16} />}
          value={eur(k?.spendMonthCents)}
          label="Spend this month"
        />
        <StatCard
          icon={<Radio size={16} />}
          value={num(k?.liveNow)}
          label="Live now"
        />
        <StatCard
          icon={<CheckCircle2 size={16} />}
          value={num(k?.sessions30Days)}
          label="Sessions (30d)"
        />
        <StatCard
          icon={<Clock size={16} />}
          value={`${num(k?.avgDurationMin)}m`}
          label="Avg duration"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent sessions */}
        <section
          className="rounded-2xl border lg:col-span-2"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <header
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--text)" }}
            >
              Recent sessions
            </h2>
            <Activity size={14} style={{ color: "var(--text-muted)" }} />
          </header>
          {sessions.loading ? (
            <LoadingState />
          ) : (sessions.data?.sessions ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState
                compact
                icon={<Activity size={18} />}
                title="No sessions yet"
                body="Sessions will appear here as your team uses Relay."
              />
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
                    <div
                      className="truncate text-sm"
                      style={{ color: "var(--text)" }}
                    >
                      {s.customerName || "—"}
                      {s.projectName ? (
                        <span style={{ color: "var(--text-faint)" }}>
                          {" "}
                          · {s.projectName}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {new Date(s.createdAt).toLocaleDateString()} ·{" "}
                      {s.durationMinutes ? `${s.durationMinutes}m` : "—"} ·{" "}
                      {s.chargeCents != null ? eur(s.chargeCents) : "—"}
                    </div>
                  </div>
                  <StatusBadge
                    compact
                    tone={STATUS_TONE[s.status] ?? "neutral"}
                  >
                    {s.status}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top departments */}
        <section
          className="rounded-2xl border"
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
              Top departments
            </h2>
          </header>
          {depts.loading ? (
            <LoadingState />
          ) : topDepts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                compact
                title="No departments"
                body="Create a department to start allocating minutes."
              />
            </div>
          ) : (
            <ul>
              {topDepts.map((d) => {
                const pct =
                  d.allocatedMinutes > 0
                    ? Math.min(
                        100,
                        Math.round((d.usedMinutes / d.allocatedMinutes) * 100)
                      )
                    : 0;
                return (
                  <li
                    key={d.id}
                    className="border-t px-4 py-3 first:border-t-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="truncate text-sm"
                        style={{ color: "var(--text)" }}
                      >
                        {d.name}
                      </span>
                      <span
                        className="text-xs tabular-nums"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {num(d.usedMinutes)}/{num(d.allocatedMinutes)}m
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full"
                      style={{ background: "var(--surface-raised)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: "var(--primary)",
                        }}
                      />
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
