"use client";

/*
 * Department Dashboard — scoped to the manager's single department. Stat
 * cards (members, minutes) + recent sessions (PII-minimized).
 */

import { useState } from "react";
import {
  Users,
  Timer,
  Gauge,
  Activity,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button, StatusBadge, EmptyState } from "@/app/_components/ui";
import { DeptSetupWizard } from "./DeptSetupWizard";
import {
  useApiData,
  num,
  TabBody,
  StatCard,
  LoadingState,
  ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Employees = {
  department: {
    id: string;
    name: string;
    status: string;
    allocatedMinutes: number;
    usedMinutes: number;
    remainingMinutes: number;
  };
  enterprise: { id: string; name: string; enterpriseCode: string };
  employees: Array<{ id: string; status: string; usedMinutes: number }>;
};
type Session = {
  id: string;
  status: string;
  createdAt: string;
  durationMinutes: number | null;
  chargeCents: number | null;
  memberName: string;
  projectName: string | null;
};

const TONE: Record<string, "ok" | "warn" | "risk" | "neutral" | "info"> = {
  live: "ok",
  joining: "ok",
  assigned: "info",
  queued: "warn",
  ended: "neutral",
  cancelled: "risk",
  abandoned: "risk",
  grace: "warn",
};

export function DeptDashboardTab() {
  const emp = useApiData<Employees>("/api/department/employees");
  const sess = useApiData<{ sessions: Session[] }>(
    "/api/department/sessions?limit=8"
  );
  const [wizardOpen, setWizardOpen] = useState(false);

  if (emp.loading)
    return (
      <TabBody>
        <LoadingState />
      </TabBody>
    );
  if (emp.error)
    return (
      <TabBody>
        <ErrorState message={emp.error} onRetry={emp.reload} />
      </TabBody>
    );
  const d = emp.data?.department;
  const members = emp.data?.employees ?? [];
  const needsSetup = members.length === 0;

  return (
    <TabBody>
      <h1
        className="mb-1 font-serif text-2xl font-medium"
        style={{ color: "var(--text)" }}
      >
        {d?.name ?? "Department"}
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {emp.data?.enterprise.name} · {num(members.length)} members
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
                Set up {d?.name ?? "your department"}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Invite your team and start allocating minutes.
              </div>
            </div>
          </div>
          <Button
            iconLeft={<ArrowRight size={14} />}
            onClick={() => setWizardOpen(true)}
          >
            Invite your team
          </Button>
        </div>
      )}

      <DeptSetupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        deptName={d?.name ?? "your department"}
        allocatedMinutes={d?.allocatedMinutes ?? 0}
        onChanged={() => {
          emp.reload();
        }}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Users size={16} />}
          value={num(members.length)}
          label="Members"
        />
        <StatCard
          icon={<Timer size={16} />}
          value={`${num(d?.usedMinutes)}m`}
          label="Minutes used"
        />
        <StatCard
          icon={<Gauge size={16} />}
          value={`${num(d?.remainingMinutes)}m`}
          label="Remaining"
        />
        <StatCard
          icon={<Gauge size={16} />}
          value={`${num(d?.allocatedMinutes)}m`}
          label="Allocated"
        />
      </div>

      <section
        className="mt-6 rounded-2xl border"
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
        {sess.loading ? (
          <LoadingState />
        ) : (sess.data?.sessions ?? []).length === 0 ? (
          <div className="p-6">
            <EmptyState
              compact
              title="No sessions yet"
              body="Sessions from your team will appear here."
            />
          </div>
        ) : (
          <ul>
            {(sess.data?.sessions ?? []).map((s) => (
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
                    {s.memberName || "—"}
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
                    {s.durationMinutes ? `${s.durationMinutes}m` : "—"}
                  </div>
                </div>
                <StatusBadge compact tone={TONE[s.status] ?? "neutral"}>
                  {s.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </TabBody>
  );
}
