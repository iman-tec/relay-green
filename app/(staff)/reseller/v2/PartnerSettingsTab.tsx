"use client";

/*
 * Channel Partner Settings — partner org profile, internal team management,
 * white-label branding, payout details, notifications. No client member data.
 *
 * TODO(api): partner-profile PATCH, internal-user invite, payout details, and
 * white-label persistence need endpoints. Controls save optimistically + are
 * marked; the internal-team list is local until the backend lands.
 */

import { useState } from "react";
import { Briefcase, Users, Palette, Wallet, Bell, UserPlus, Mail, Trash2 } from "lucide-react";
import { Button, Input, Modal, Avatar, EmptyState } from "@/app/_components/ui";
import { useApiData, num, TabBody, LoadingState, ErrorState } from "@/app/(staff)/enterprise/v2/_shared";
import { SettingsSection, EditableField, CopyRow, SettingsToggle, IdentityBlock } from "@/app/(staff)/enterprise/v2/settingsKit";

type Dashboard = {
  reseller: { name: string; resellerCode: string; status: string; commission: number; totalEnterprises: number };
};
type InternalUser = { id: string; name: string; email: string; role: string };

export function PartnerSettingsTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>("/api/reseller/dashboard");

  // Internal team is local until a backend endpoint exists (TODO(api)).
  const [team, setTeam] = useState<InternalUser[]>([
    { id: "self", name: "You (owner)", email: "—", role: "Owner" },
  ]);
  const [payoutEmail, setPayoutEmail] = useState("");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [brandColor, setBrandColor] = useState("#16a34a");
  const [notif, setNotif] = useState({ newClient: true, lowMinutes: true, payout: true });
  const [note, setNote] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [iName, setIName] = useState(""); const [iEmail, setIEmail] = useState(""); const [iRole, setIRole] = useState("Manager");

  if (loading) return <TabBody><LoadingState /></TabBody>;
  if (error) return <TabBody><ErrorState message={error} onRetry={reload} /></TabBody>;
  const r = data?.reseller;

  const addMember = () => {
    if (!iName.trim() || !iEmail.trim()) return;
    setTeam((t) => [...t, { id: crypto.randomUUID(), name: iName.trim(), email: iEmail.trim(), role: iRole }]);
    setInviteOpen(false); setIName(""); setIEmail("");
    setNote("TODO(api): internal-user invite is local only until the backend endpoint exists.");
  };

  return (
    <TabBody>
      <h1 className="mb-6 font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Settings</h1>
      <div className="flex flex-col gap-5">

        <SettingsSection icon={<Briefcase size={16} />} title="Channel Partner profile">
          <IdentityBlock name={r?.name ?? ""} sub={`${num(r?.totalEnterprises)} enterprises · ${num(r?.commission)}% commission`} />
          <EditableField label="Partner name" value={r?.name ?? ""} onSave={async () => setNote("TODO(api): partner-name PATCH not wired yet.")} />
          <CopyRow label="Partner code" value={r?.resellerCode ?? ""} />
          <EditableField label="Commission rate" value={`${num(r?.commission)}%`} readOnly hint="Set by Relay in your partner agreement." />
        </SettingsSection>

        <SettingsSection icon={<Users size={16} />} title="Internal team" desc="Your own team members with access to this partner account.">
          <div className="-mt-1 mb-3 flex justify-end">
            <Button size="sm" iconLeft={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>Add member</Button>
          </div>
          {team.length === 0 ? (
            <EmptyState compact title="No internal users" body="Add teammates who help manage your clients." />
          ) : (
            <ul>
              {team.map((u) => (
                <li key={u.id} className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0" style={{ borderColor: "var(--border)" }}>
                  <Avatar size="sm" name={u.name} email={u.email === "—" ? undefined : u.email} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" style={{ color: "var(--text)" }}>{u.name}</div>
                    <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{u.email}</div>
                  </div>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{u.role}</span>
                  {u.id !== "self" && (
                    <button type="button" aria-label="Remove" onClick={() => setTeam((t) => t.filter((x) => x.id !== u.id))} className="rounded-md p-1.5" style={{ color: "var(--text-faint)" }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <SettingsSection icon={<Palette size={16} />} title="White-label branding">
          <SettingsToggle label="Enable white-label" desc="Show your brand instead of Relay's to your clients." on={whiteLabel} onChange={setWhiteLabel} />
          {whiteLabel && (
            <div className="flex items-center justify-between border-t py-3" style={{ borderColor: "var(--border)" }}>
              <div className="text-sm" style={{ color: "var(--text)" }}>Brand accent color</div>
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded-md border" style={{ borderColor: "var(--border)" }} aria-label="Brand color" />
            </div>
          )}
          <div className="mt-3"><Button size="sm" onClick={() => setNote("TODO(api): white-label persistence not wired yet.")}>Save branding</Button></div>
        </SettingsSection>

        <SettingsSection icon={<Wallet size={16} />} title="Payout details">
          <EditableField label="Payout email" value={payoutEmail} placeholder="finance@partner.com" onSave={async (v) => { setPayoutEmail(v); setNote("TODO(api): payout details save not wired yet."); }} hint="Where commission statements + payouts are sent." />
        </SettingsSection>

        <SettingsSection icon={<Bell size={16} />} title="Notifications">
          <SettingsToggle label="New client onboarded" desc="When an enterprise is added to your portfolio." on={notif.newClient} onChange={(v) => setNotif({ ...notif, newClient: v })} />
          <SettingsToggle label="Client low-minutes" desc="When a client's pool runs low." on={notif.lowMinutes} onChange={(v) => setNotif({ ...notif, lowMinutes: v })} />
          <SettingsToggle label="Payout processed" desc="When a commission payout is sent." on={notif.payout} onChange={(v) => setNotif({ ...notif, payout: v })} />
          <div className="mt-3"><Button size="sm" onClick={() => setNote("TODO(api): notification prefs save not wired yet.")}>Save preferences</Button></div>
        </SettingsSection>

        {note && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{note}</p>}
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Add internal user" description="A teammate who helps manage your client portfolio."
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button><Button onClick={addMember} iconLeft={<Mail size={14} />}>Add</Button></div>}>
        <div className="flex flex-col gap-3">
          <Input label="Full name" value={iName} onChange={(e) => setIName(e.target.value)} placeholder="Sam Lee" />
          <Input label="Email" type="email" value={iEmail} onChange={(e) => setIEmail(e.target.value)} placeholder="sam@partner.com" />
          <label className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--text)" }}>
            Role
            <select value={iRole} onChange={(e) => setIRole(e.target.value)} className="h-11 rounded-lg border px-3" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}>
              <option>Manager</option><option>Analyst</option><option>Admin</option>
            </select>
          </label>
        </div>
      </Modal>
    </TabBody>
  );
}
