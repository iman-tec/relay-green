"use client";

/*
 * Department Settings — limited (a strict subset of the enterprise admin's).
 * Department identity, manager profile, notification prefs, team shortcut.
 * NO org-wide billing, NO other departments, NO privacy/erasure controls
 * (those belong to the enterprise admin / controller).
 */

import { useState } from "react";
import { Building2, Bell, Users, Info } from "lucide-react";
import { Button } from "@/app/_components/ui";
import { useApiData, num, TabBody, LoadingState, ErrorState } from "@/app/(staff)/enterprise/v2/_shared";
import { SettingsSection, EditableField, CopyRow, SettingsToggle, IdentityBlock } from "@/app/(staff)/enterprise/v2/settingsKit";

type Employees = {
  department: { id: string; name: string; departmentCode: string; status: string; allocatedMinutes: number; usedMinutes: number; remainingMinutes: number };
  enterprise: { name: string; enterpriseCode: string };
  employees: Array<{ id: string }>;
};

export function DeptSettingsTab() {
  const { data, loading, error, reload } = useApiData<Employees>("/api/department/employees");
  const [notif, setNotif] = useState({ sessions: true, lowMinutes: true, newMember: true });
  const [note, setNote] = useState<string | null>(null);

  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const d = data?.department;
  const memberCount = data?.employees?.length ?? 0;

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Settings</h1>
      <div className="flex flex-col gap-5">

        <SettingsSection icon={<Building2 size={16} />} title="Department">
          <IdentityBlock name={d?.name ?? ""} sub={`${data?.enterprise.name ?? ""} · ${num(memberCount)} members`} />
          {/* Department display name is editable by the manager; allocation is not. */}
          <EditableField label="Department name" value={d?.name ?? ""} onSave={async () => setNote("TODO(api): department-name PATCH not wired yet.")} />
          <CopyRow label="Department code" value={d?.departmentCode ?? ""} />
          <div className="flex items-center justify-between border-t py-3" style={{ borderColor: "var(--border)" }}>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Minute allocation</div>
            <div className="text-sm tabular-nums" style={{ color: "var(--text)" }}>
              {num(d?.usedMinutes)} / {num(d?.allocatedMinutes)} min used
            </div>
          </div>
          <div className="mt-2 flex items-start gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}>
            <Info size={14} className="mt-0.5" style={{ color: "var(--text-muted)" }} />
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Your minute pool + department structure are managed by your enterprise admin.
            </p>
          </div>
        </SettingsSection>

        <SettingsSection icon={<Users size={16} />} title="Team">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Invite + manage your {num(memberCount)} team members from the <strong style={{ color: "var(--text)" }}>Team members</strong> tab.
          </p>
        </SettingsSection>

        <SettingsSection icon={<Bell size={16} />} title="Notifications">
          <SettingsToggle label="New session alerts" desc="When a team member starts a session." on={notif.sessions} onChange={(v) => setNotif({ ...notif, sessions: v })} />
          <SettingsToggle label="Low-minutes warning" desc="When the department pool runs low." on={notif.lowMinutes} onChange={(v) => setNotif({ ...notif, lowMinutes: v })} />
          <SettingsToggle label="New member joined" desc="When someone is added to the department." on={notif.newMember} onChange={(v) => setNotif({ ...notif, newMember: v })} />
          <div className="mt-3"><Button size="sm" onClick={() => setNote("TODO(api): notification prefs save not wired yet.")}>Save preferences</Button></div>
        </SettingsSection>

        {note && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{note}</p>}
      </div>
    </TabBody>
  );
}
