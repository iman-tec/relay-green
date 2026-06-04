"use client";

/*
 * Enterprise Settings — the org admin is the GDPR controller. Rich, sectioned
 * settings: organization identity + profile, internal team (admins),
 * notifications, Privacy & Data (retention / export / erasure), SSO.
 *
 * Wired sections (real persistence):
 *   - Organization name + primary domain  → /api/enterprise/org (PATCH)
 *   - Notifications                       → /api/enterprise/notification-prefs
 *   - Data retention                      → /api/enterprise/org (retentionDays)
 *   - Export organisation data            → /api/enterprise/export (ZIP)
 *   - Member erasure                      → Members tab (per-row action)
 *
 * SSO stays informational — provisioned by Relay support.
 */

import { useCallback, useEffect, useState } from "react";
import { Building2, Users, Bell, ShieldCheck, KeyRound, Download, Clock, Trash2, UserPlus, Mail } from "lucide-react";
import { Button, Input, Modal, Avatar, StatusBadge, EmptyState } from "@/app/_components/ui";
import { useApiData, LoadingState, ErrorState } from "./_shared";
import {
  TabBody, TabTitle, PrimaryButton, OutlineButton,
  SettingsSection, EditableField, CopyRow, SettingsToggle, IdentityBlock,
} from "./_kit";

type Me = {
  org: {
    id: string; name: string; status: string;
    enterpriseCode?: string; primaryDomain?: string | null;
    discountPct?: number; discountUntil?: string | null;
    retentionDays?: number;
  };
  channelPartner?: { name: string; discountPct: number } | null;
};
type Member = { id: string; displayName: string; email: string; primaryRole: string; status: string };

type PrefsPayload = {
  prefs: {
    sessionAlerts: boolean;
    lowMinutes:    boolean;
    weeklyDigest:  boolean;
  };
};

const RETENTION = [
  { value: 90, label: "90 days" }, { value: 180, label: "180 days" },
  { value: 365, label: "12 months" }, { value: 0, label: "Indefinite" },
];

export function SettingsTab() {
  const me    = useApiData<Me>("/api/enterprise/me");
  const staff = useApiData<{ members: Member[] }>("/api/enterprise/users?scope=staff");
  const prefsFetch = useApiData<PrefsPayload>("/api/enterprise/notification-prefs");

  const [retention, setRetention] = useState(365);
  const [notif, setNotif] = useState({ sessions: true, lowMinutes: true, weekly: false });
  const [note, setNote] = useState<string | null>(null);

  const [savingRetention, setSavingRetention] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [iEmail, setIEmail] = useState(""); const [iName, setIName] = useState("");
  const [iBusy, setIBusy] = useState(false); const [iErr, setIErr] = useState<string | null>(null);

  // Sync local editor state from server fetches once they land.
  const orgFromServer = me.data?.org;
  useEffect(() => {
    if (!orgFromServer) return;
    setRetention(orgFromServer.retentionDays ?? 0);
  }, [orgFromServer]);

  const p = prefsFetch.data?.prefs;
  useEffect(() => {
    if (!p) return;
    setNotif({
      sessions:   p.sessionAlerts,
      lowMinutes: p.lowMinutes,
      weekly:     p.weeklyDigest,
    });
  }, [p]);

  const patchOrg = useCallback(async (
    body: { name?: string; primaryDomain?: string | null; retentionDays?: number | null },
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const res = await fetch("/api/enterprise/org", {
      method:  "PATCH",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: b.error ?? "unknown" };
  }, []);

  const humanOrgError = (code: string) => {
    switch (code) {
      case "name_required":    return "Name can't be empty.";
      case "invalid_domain":   return "That doesn't look like a valid domain (e.g. \"acme.com\").";
      case "domain_taken":     return "Another organisation already uses that domain.";
      case "invalid_retention": return "Pick one of the available retention windows.";
      case "nothing_to_update": return "Nothing changed.";
      default:                 return `Couldn't save (${code}).`;
    }
  };

  const saveRetention = useCallback(async () => {
    setSavingRetention(true);
    const res = await patchOrg({ retentionDays: retention });
    setSavingRetention(false);
    setNote(res.ok ? "Retention setting saved." : humanOrgError(res.error));
    if (res.ok) me.reload();
  }, [retention, patchOrg, me]);

  const savePrefs = useCallback(async () => {
    setSavingPrefs(true);
    try {
      const res = await fetch("/api/enterprise/notification-prefs", {
        method:  "PUT",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({
          sessionAlerts: notif.sessions,
          lowMinutes:    notif.lowMinutes,
          weeklyDigest:  notif.weekly,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(`Couldn't save preferences (${b.error ?? "unknown error"}).`);
      } else {
        setNote("Preferences saved.");
        prefsFetch.reload();
      }
    } finally {
      setSavingPrefs(false);
    }
  }, [notif, prefsFetch]);

  const requestExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/enterprise/export", { method: "POST" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(`Couldn't export (${b.error ?? "unknown error"}).`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(disposition);
      const filename = m?.[1] ?? "organization-export.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setNote("Export downloaded.");
    } catch (e) {
      setNote(`Couldn't export (${e instanceof Error ? e.message : "network error"}).`);
    } finally {
      setExporting(false);
    }
  }, []);

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
      <TabTitle title="Settings" />
      <div className="flex flex-col gap-4">

        <SettingsSection icon={<Building2 size={16} />} title="Organization">
          <IdentityBlock name={org?.name ?? ""} sub={org?.primaryDomain ?? org?.status} />
          <EditableField
            label="Organization name"
            value={org?.name ?? ""}
            onSave={async (v) => {
              const res = await patchOrg({ name: v });
              if (res.ok) { setNote("Organisation name saved."); me.reload(); }
              else { setNote(humanOrgError(res.error)); }
            }}
          />
          <EditableField
            label="Primary domain"
            value={org?.primaryDomain ?? ""}
            placeholder="acme.com"
            onSave={async (v) => {
              const res = await patchOrg({ primaryDomain: v });
              if (res.ok) { setNote(v.trim() === "" ? "Primary domain cleared." : "Primary domain saved."); me.reload(); }
              else { setNote(humanOrgError(res.error)); }
            }}
            hint="Used to auto-match new members by email."
          />
          <CopyRow label="Enterprise code" value={org?.enterpriseCode ?? ""} />
          {me.data?.channelPartner ? (
            <>
              <EditableField label="Channel Partner" value={me.data.channelPartner.name} readOnly hint="The partner who onboarded your organization." />
              <EditableField label="Partner discount" value={`${me.data.channelPartner.discountPct}%`} readOnly hint="Discount applied to your usage through this partner." />
            </>
          ) : null}
          {org?.discountPct ? (
            <EditableField
              label="Promo discount"
              value={`${org.discountPct}%${org.discountUntil ? ` until ${new Date(org.discountUntil).toLocaleDateString()}` : ""}`}
              readOnly
              hint="A promotional discount on your usage."
            />
          ) : null}
        </SettingsSection>

        <SettingsSection icon={<Users size={16} />} title="Internal team" desc="Admins who manage this organization.">
          <div className="-mt-1 mb-3 flex justify-end">
            <PrimaryButton size="sm" icon={<UserPlus size={12} />} onClick={() => setInviteOpen(true)}>Invite admin</PrimaryButton>
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
          <div className="mt-3">
            <PrimaryButton size="sm" disabled={savingPrefs} onClick={savePrefs}>
              {savingPrefs ? "Saving…" : "Save preferences"}
            </PrimaryButton>
          </div>
        </SettingsSection>

        <SettingsSection icon={<ShieldCheck size={16} />} title="Privacy & data" desc="You are the data controller for this organization." accent>
          <div className="flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start gap-3">
              <Clock size={16} className="mt-0.5" style={{ color: "var(--text-muted)" }} />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Data retention</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>How long session records are kept before scheduled purge.</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
                className="h-10 rounded-lg border px-3 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}
              >
                {RETENTION.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <PrimaryButton size="sm" disabled={savingRetention} onClick={saveRetention}>
                {savingRetention ? "Saving…" : "Save"}
              </PrimaryButton>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start gap-3">
              <Download size={16} className="mt-0.5" style={{ color: "var(--text-muted)" }} />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Export organization data</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>Portable .zip with CSVs for org, departments, members, sessions, usage and billing.</div>
              </div>
            </div>
            <OutlineButton size="sm" disabled={exporting} onClick={requestExport}>
              {exporting ? "Preparing…" : "Download export"}
            </OutlineButton>
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start gap-3">
              <Trash2 size={16} className="mt-0.5" style={{ color: "var(--risk)" }} />
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Member erasure</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Right-to-erasure strips a member&apos;s name, avatar and email visibility while preserving aggregate session records for billing. Trigger it per member from the <strong style={{ color: "var(--text)" }}>Members</strong> tab.
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection icon={<KeyRound size={16} />} title="Single sign-on">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
