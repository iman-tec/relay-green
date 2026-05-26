"use client";

/*
 * Enterprise Settings — the org admin is the GDPR controller. Rich, sectioned
 * settings: organization identity + profile, internal team (admins),
 * notifications, Privacy & Data (retention / export / erasure), SSO.
 *
 * TODO(api): org-profile PATCH, notification prefs, retention/export/erasure
 * backends don't all exist yet — those controls save optimistically + are
 * marked. Internal-team invite uses the live /api/enterprise/users endpoint.
 */

import { useState } from "react";
import { Building2, Users, Bell, ShieldCheck, KeyRound, Download, Clock, Trash2, UserPlus, Mail } from "lucide-react";
import { Button, Input, Modal, Avatar, StatusBadge, EmptyState } from "@/app/_components/ui";
import { useApiData, num, TabBody, LoadingState, ErrorState } from "./_shared";
import { SettingsSection, EditableField, CopyRow, SettingsToggle, IdentityBlock } from "./settingsKit";

type Me = { org: { id: string; name: string; status: string; enterpriseCode?: string; primaryDomain?: string | null } };
type Member = { id: string; displayName: string; email: string; primaryRole: string; status: string };

const RETENTION = [
  { value: 90, label: "90 days" }, { value: 180, label: "180 days" },
  { value: 365, label: "12 months" }, { value: 0, label: "Indefinite" },
];

export function SettingsTab() {
  const me = useApiData<Me>("/api/enterprise/me");
  const staff = useApiData<{ members: Member[] }>("/api/enterprise/users?scope=staff");

  const [retention, setRetention] = useState(365);
  const [notif, setNotif] = useState({ sessions: true, lowMinutes: true, weekly: false });
  const [note, setNote] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [iEmail, setIEmail] = useState(""); const [iName, setIName] = useState("");
  const [iBusy, setIBusy] = useState(false); const [iErr, setIErr] = useState<string | null>(null);

  if (me.loading) return <TabBody><LoadingState /></TabBody>;
  if (me.error) return <TabBody><ErrorState message={me.error} onRetry={me.reload} /></TabBody>;
  const org = me.data?.org;

  const invite = async () => {
    if (!iEmail.trim() || !iName.trim()) { setIErr("Name and email required."); return; }
    setIBusy(true); setIErr(null);
    try {
      const r = await fetch("/api/enterprise/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: iEmail.trim(), displayName: iName.trim(), role: "enterprise_admin" }),
      });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(b.error || "Invite failed");
      setInviteOpen(false); setIEmail(""); setIName(""); staff.reload();
    } catch (e) { setIErr(e instanceof Error ? e.message : "Invite failed"); }
    finally { setIBusy(false); }
  };

  const admins = (staff.data?.members ?? []);

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Settings</h1>
      <div className="flex flex-col gap-5">

        <SettingsSection icon={<Building2 size={16} />} title="Organization">
          <IdentityBlock name={org?.name ?? ""} sub={org?.primaryDomain ?? org?.status} />
          <EditableField label="Organization name" value={org?.name ?? ""} onSave={async () => setNote("TODO(api): org-name PATCH not wired yet.")} />
          <EditableField label="Primary domain" value={org?.primaryDomain ?? ""} placeholder="acme.com" onSave={async () => setNote("TODO(api): domain PATCH not wired yet.")} hint="Used to auto-match new members by email." />
          <CopyRow label="Enterprise code" value={org?.enterpriseCode ?? ""} />
        </SettingsSection>

        <SettingsSection icon={<Users size={16} />} title="Internal team" desc="Admins who manage this organization.">
          <div className="-mt-1 mb-3 flex justify-end">
            <Button size="sm" iconLeft={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>Invite admin</Button>
          </div>
          {staff.loading ? <LoadingState /> : admins.length === 0 ? (
            <EmptyState compact title="No other admins" body="Invite teammates to co-manage the org." />
          ) : (
            <ul>
              {admins.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                  <Avatar size="sm" name={m.displayName} email={m.email} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: "var(--text)" }}>{m.displayName || "—"}</div>
                    <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{m.email}</div>
                  </div>
                  <StatusBadge compact tone={m.status === "active" ? "ok" : "warn"}>{m.primaryRole || "admin"}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <SettingsSection icon={<Bell size={16} />} title="Notifications">
          <SettingsToggle label="New session alerts" desc="When a member starts a session." on={notif.sessions} onChange={(v) => setNotif({ ...notif, sessions: v })} />
          <SettingsToggle label="Low-minutes warning" desc="When an org or department pool runs low." on={notif.lowMinutes} onChange={(v) => setNotif({ ...notif, lowMinutes: v })} />
          <SettingsToggle label="Weekly usage digest" desc="A Monday summary email." on={notif.weekly} onChange={(v) => setNotif({ ...notif, weekly: v })} />
          <div className="mt-3"><Button size="sm" onClick={() => setNote("TODO(api): notification prefs save not wired yet.")}>Save preferences</Button></div>
        </SettingsSection>

        <SettingsSection icon={<ShieldCheck size={16} />} title="Privacy & data" desc="You are the data controller for this organization." accent>
          <div className="flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start gap-3"><Clock size={16} className="mt-0.5" style={{ color: "var(--text-muted)" }} /><div><div className="text-sm font-medium" style={{ color: "var(--text)" }}>Data retention</div><div className="text-xs" style={{ color: "var(--text-muted)" }}>Purge session records older than this.</div></div></div>
            <div className="flex items-center gap-2">
              <select value={retention} onChange={(e) => setRetention(Number(e.target.value))} className="h-10 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}>
                {RETENTION.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Button size="sm" onClick={() => setNote("TODO(api): retention save not wired yet.")}>Save</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start gap-3"><Download size={16} className="mt-0.5" style={{ color: "var(--text-muted)" }} /><div><div className="text-sm font-medium" style={{ color: "var(--text)" }}>Export organization data</div><div className="text-xs" style={{ color: "var(--text-muted)" }}>Portable bundle (data portability).</div></div></div>
            <Button size="sm" variant="secondary" onClick={() => setNote("TODO(api): org export not wired yet.")}>Request export</Button>
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start gap-3"><Trash2 size={16} className="mt-0.5" style={{ color: "var(--risk)" }} /><div><div className="text-sm font-medium" style={{ color: "var(--text)" }}>Member erasure</div><div className="text-xs" style={{ color: "var(--text-muted)" }}>Right-to-erasure — handle from the Members tab.</div></div></div>
            <Button size="sm" variant="ghost" onClick={() => setNote("TODO(api): erasure flow not wired yet.")}>Learn more</Button>
          </div>
        </SettingsSection>

        <SettingsSection icon={<KeyRound size={16} />} title="Single sign-on">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {/* TODO(api): SSO config (SAML/OIDC) when present */}
            SAML / OIDC single sign-on is configured by Relay. Contact support to enable SSO for your domain.
          </p>
        </SettingsSection>

        {note && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{note}</p>}
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite an admin" description="They can co-manage this organization."
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={iBusy}>Cancel</Button><Button onClick={invite} loading={iBusy} iconLeft={<Mail size={14} />}>Send invite</Button></div>}>
        <div className="flex flex-col gap-3">
          <Input label="Full name" value={iName} onChange={(e) => setIName(e.target.value)} placeholder="Jane Doe" />
          <Input label="Email" type="email" value={iEmail} onChange={(e) => setIEmail(e.target.value)} placeholder="jane@company.com" />
          {iErr && <p className="text-xs" style={{ color: "var(--risk)" }}>{iErr}</p>}
        </div>
      </Modal>
    </TabBody>
  );
}
