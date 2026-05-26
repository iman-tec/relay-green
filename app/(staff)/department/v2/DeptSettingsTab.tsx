"use client";

/*
 * Department Settings — limited: department profile + notification prefs.
 * NO org-wide billing, NO other departments, NO privacy/erasure controls
 * (those belong to the enterprise admin).
 */

import { useState } from "react";
import { Building2, Bell } from "lucide-react";
import { Button } from "@/app/_components/ui";
import {
  useApiData, TabBody, LoadingState, ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";

type Employees = {
  department: { id: string; name: string; departmentCode: string; status: string };
  enterprise: { name: string; enterpriseCode: string };
};

export function DeptSettingsTab() {
  const { data, loading, error, reload } = useApiData<Employees>("/api/department/employees");
  const [notifSessions, setNotifSessions] = useState(true);
  const [notifLowMinutes, setNotifLowMinutes] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const d = data?.department;

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Settings</h1>

      <section className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Department profile</h2>
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Department" value={d?.name ?? "—"} />
          <Row label="Status" value={d?.status ?? "—"} />
          <Row label="Department code" value={d?.departmentCode ?? "—"} mono />
          <Row label="Enterprise" value={data?.enterprise.name ?? "—"} />
        </dl>
        <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
          Department name + minute allocation are managed by your enterprise admin.
        </p>
      </section>

      <section className="mt-6 rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-4 flex items-center gap-2">
          <Bell size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Notifications</h2>
        </div>
        <Toggle label="New session alerts" desc="Notify me when a team member starts a session." on={notifSessions} onChange={setNotifSessions} />
        <Toggle label="Low-minutes warning" desc="Warn me when the department pool runs low." on={notifLowMinutes} onChange={setNotifLowMinutes} />
        <div className="mt-3">
          <Button size="sm" onClick={() => setNote("TODO(api): notification prefs save not wired yet.")}>Save preferences</Button>
          {note && <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{note}</p>}
        </div>
      </section>
    </TabBody>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"} style={{ color: "var(--text)" }}>{value}</dd>
    </div>
  );
}

function Toggle({ label, desc, on, onChange }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between border-t py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 pr-3">
        <div className="text-sm" style={{ color: "var(--text)" }}>{label}</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: on ? "var(--primary)" : "var(--surface-raised)" }}
      >
        <span
          className="absolute top-0.5 size-5 rounded-full bg-white transition-all"
          style={{ left: on ? 22 : 2 }}
        />
      </button>
    </div>
  );
}
