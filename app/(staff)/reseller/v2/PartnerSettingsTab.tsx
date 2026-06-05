"use client";

/*
 * Channel Partner Settings — partner org profile, internal team management,
 * white-label branding, payout details, notifications.
 *
 * Wired sections (real persistence):
 *   - Internal team:    /api/reseller/team-members
 *   - White-label:      /api/reseller/branding
 *   - Notifications:    /api/reseller/notification-prefs
 *   - Payout details:   /api/reseller/payout
 *
 * Still TODO (intentionally scoped out — server endpoint doesn't exist yet):
 *   - Partner-profile PATCH (name edit)
 */

import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  Users,
  Palette,
  Wallet,
  Bell,
  UserPlus,
  Mail,
  Trash2,
} from "lucide-react";
import { Button, Input, Modal, Avatar, EmptyState } from "@/app/_components/ui";
import {
  useApiData,
  num,
  TabBody,
  LoadingState,
  ErrorState,
} from "@/app/(staff)/enterprise/v2/_shared";
import {
  SettingsSection,
  EditableField,
  CopyRow,
  SettingsToggle,
  IdentityBlock,
} from "@/app/(staff)/enterprise/v2/settingsKit";

type Dashboard = {
  reseller: {
    name: string;
    resellerCode: string;
    status: string;
    commission: number;
    totalEnterprises: number;
  };
};

type TeamMember = {
  id: string;
  email: string;
  fullName: string | null;
  role: "manager" | "analyst" | "admin";
  status: "invited" | "active" | "removed";
  userId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
};
type TeamPayload = {
  owner: { id: string; email: string; fullName: string | null } | null;
  team: TeamMember[];
};

type BrandingPayload = {
  branding: {
    whiteLabelEnabled: boolean;
    accentColor: string;
    displayName: string | null;
    supportEmail: string | null;
  };
};

type PrefsPayload = {
  prefs: {
    newClientOnboarded: boolean;
    clientLowMinutes: boolean;
    payoutProcessed: boolean;
  };
};

type PayoutPayload = { payoutEmail: string | null };

const ROLE_LABEL: Record<TeamMember["role"], string> = {
  manager: "Manager",
  analyst: "Analyst",
  admin: "Admin",
};

export function PartnerSettingsTab() {
  const { data, loading, error, reload } = useApiData<Dashboard>(
    "/api/reseller/dashboard"
  );
  const teamFetch = useApiData<TeamPayload>("/api/reseller/team-members");
  const brandingFetch = useApiData<BrandingPayload>("/api/reseller/branding");
  const prefsFetch = useApiData<PrefsPayload>(
    "/api/reseller/notification-prefs"
  );
  const payoutFetch = useApiData<PayoutPayload>("/api/reseller/payout");

  // Local editor state for branding + prefs, synced from fetched data once loaded.
  const [payoutEmail, setPayoutEmail] = useState("");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [brandColor, setBrandColor] = useState("#16a34a");
  const [brandDisplayName, setBrandDisplayName] = useState("");
  const [brandSupportEmail, setBrandSupportEmail] = useState("");
  const [notif, setNotif] = useState({
    newClient: true,
    lowMinutes: true,
    payout: true,
  });

  // Sync editors from server when fetches land.
  const b = brandingFetch.data?.branding;
  useEffect(() => {
    if (!b) return;
    setWhiteLabel(b.whiteLabelEnabled);
    setBrandColor(b.accentColor);
    setBrandDisplayName(b.displayName ?? "");
    setBrandSupportEmail(b.supportEmail ?? "");
  }, [b]);

  const p = prefsFetch.data?.prefs;
  useEffect(() => {
    if (!p) return;
    setNotif({
      newClient: p.newClientOnboarded,
      lowMinutes: p.clientLowMinutes,
      payout: p.payoutProcessed,
    });
  }, [p]);

  const pe = payoutFetch.data?.payoutEmail;
  useEffect(() => {
    if (pe === undefined) return;
    setPayoutEmail(pe ?? "");
  }, [pe]);

  const [note, setNote] = useState<string | null>(null);
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [iName, setIName] = useState("");
  const [iEmail, setIEmail] = useState("");
  const [iRole, setIRole] = useState<TeamMember["role"]>("manager");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const addMember = useCallback(async () => {
    const name = iName.trim();
    const email = iEmail.trim();
    if (!email) {
      setInviteError("Email is required.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/reseller/team-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          fullName: name || undefined,
          role: iRole,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setInviteError(humanizeTeamError(body.error));
        return;
      }
      setInviteOpen(false);
      setIName("");
      setIEmail("");
      setIRole("manager");
      teamFetch.reload();
      setNote("Team member added.");
    } catch {
      setInviteError("Network error. Try again.");
    } finally {
      setInviteBusy(false);
    }
  }, [iName, iEmail, iRole, teamFetch]);

  const removeMember = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/reseller/team-members/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        teamFetch.reload();
        setNote("Team member removed.");
      } else {
        setNote("Couldn't remove member. Try again.");
      }
    },
    [teamFetch]
  );

  const saveBranding = useCallback(async () => {
    setSavingBranding(true);
    try {
      const res = await fetch("/api/reseller/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          whiteLabelEnabled: whiteLabel,
          accentColor: brandColor,
          displayName: brandDisplayName.trim() || null,
          supportEmail: brandSupportEmail.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(`Couldn't save branding (${body.error ?? "unknown error"}).`);
      } else {
        setNote("Branding saved.");
        brandingFetch.reload();
      }
    } finally {
      setSavingBranding(false);
    }
  }, [
    whiteLabel,
    brandColor,
    brandDisplayName,
    brandSupportEmail,
    brandingFetch,
  ]);

  const savePrefs = useCallback(async () => {
    setSavingPrefs(true);
    try {
      const res = await fetch("/api/reseller/notification-prefs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          newClientOnboarded: notif.newClient,
          clientLowMinutes: notif.lowMinutes,
          payoutProcessed: notif.payout,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(
          `Couldn't save preferences (${body.error ?? "unknown error"}).`
        );
      } else {
        setNote("Preferences saved.");
        prefsFetch.reload();
      }
    } finally {
      setSavingPrefs(false);
    }
  }, [notif, prefsFetch]);

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
  const r = data?.reseller;

  const owner = teamFetch.data?.owner;
  const team = teamFetch.data?.team ?? [];

  return (
    <TabBody>
      <h1
        className="mb-6 font-serif text-2xl font-medium"
        style={{ color: "var(--text)" }}
      >
        Settings
      </h1>
      <div className="flex flex-col gap-5">
        <SettingsSection
          icon={<Briefcase size={16} />}
          title="Channel Partner profile"
        >
          <IdentityBlock
            name={r?.name ?? ""}
            sub={`${num(r?.totalEnterprises)} enterprises · ${num(r?.commission)}% commission`}
          />
          <EditableField
            label="Partner name"
            value={r?.name ?? ""}
            onSave={async () =>
              setNote("TODO(api): partner-name PATCH not wired yet.")
            }
          />
          <CopyRow label="Partner code" value={r?.resellerCode ?? ""} />
          <EditableField
            label="Commission rate"
            value={`${num(r?.commission)}%`}
            readOnly
            hint="Set by Relay in your partner agreement."
          />
        </SettingsSection>

        <SettingsSection
          icon={<Users size={16} />}
          title="Internal team"
          desc="Your own team members with access to this partner account."
        >
          <div className="-mt-1 mb-3 flex justify-end">
            <Button
              size="sm"
              iconLeft={<UserPlus size={14} />}
              onClick={() => {
                setInviteError(null);
                setInviteOpen(true);
              }}
            >
              Add member
            </Button>
          </div>
          {teamFetch.loading && !teamFetch.data ? (
            <LoadingState label="Loading team…" />
          ) : (
            <ul>
              {owner && (
                <li
                  key={owner.id}
                  className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <Avatar
                    size="sm"
                    name={owner.fullName ?? owner.email}
                    email={owner.email}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm"
                      style={{ color: "var(--text)" }}
                    >
                      {owner.fullName || "Account owner"}
                    </div>
                    <div
                      className="truncate text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {owner.email}
                    </div>
                  </div>
                  <span
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Owner
                  </span>
                </li>
              )}
              {team.length === 0 && !owner ? (
                <EmptyState
                  compact
                  title="No internal users"
                  body="Add teammates who help manage your clients."
                />
              ) : (
                team.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <Avatar
                      size="sm"
                      name={u.fullName ?? u.email}
                      email={u.email}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm"
                        style={{ color: "var(--text)" }}
                      >
                        {u.fullName || u.email.split("@")[0]}
                      </div>
                      <div
                        className="truncate text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {u.email}
                        {u.status === "invited" && (
                          <span
                            className="ml-1.5"
                            style={{ color: "var(--text-faint)" }}
                          >
                            · pending
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {ROLE_LABEL[u.role]}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${u.email}`}
                      onClick={() => removeMember(u.id)}
                      className="rounded-md p-1.5"
                      style={{ color: "var(--text-faint)" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {teamFetch.error && (
            <p className="mt-2 text-xs" style={{ color: "var(--risk)" }}>
              {teamFetch.error}
            </p>
          )}
        </SettingsSection>

        <SettingsSection
          icon={<Palette size={16} />}
          title="White-label branding"
        >
          <SettingsToggle
            label="Enable white-label"
            desc="Show your brand instead of Relay's to your clients."
            on={whiteLabel}
            onChange={setWhiteLabel}
          />
          {whiteLabel && (
            <>
              <div
                className="flex items-center justify-between border-t py-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="text-sm" style={{ color: "var(--text)" }}>
                  Brand accent color
                </div>
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-md border"
                  style={{ borderColor: "var(--border)" }}
                  aria-label="Brand color"
                />
              </div>
              <EditableField
                label="Display name"
                value={brandDisplayName}
                placeholder="Your partner brand name"
                onSave={async (v) => {
                  setBrandDisplayName(v);
                }}
                hint="Shown to your clients on white-labelled surfaces."
              />
              <EditableField
                label="Support email"
                value={brandSupportEmail}
                placeholder="support@partner.com"
                onSave={async (v) => {
                  setBrandSupportEmail(v);
                }}
                hint="Address your clients reach for support when white-label is on."
              />
            </>
          )}
          <div className="mt-3">
            <Button size="sm" disabled={savingBranding} onClick={saveBranding}>
              {savingBranding ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection icon={<Wallet size={16} />} title="Payout details">
          <EditableField
            label="Payout email"
            value={payoutEmail}
            placeholder="finance@partner.com"
            onSave={async (v) => {
              const next = v.trim();
              const res = await fetch("/api/reseller/payout", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ payoutEmail: next }),
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                setNote(
                  body.error === "invalid_email"
                    ? "That doesn't look like a valid email."
                    : `Couldn't save payout email (${body.error ?? "unknown error"}).`
                );
                return;
              }
              setPayoutEmail(next);
              payoutFetch.reload();
              setNote("Payout email saved.");
            }}
            hint="Where commission statements + payouts are sent."
          />
        </SettingsSection>

        <SettingsSection icon={<Bell size={16} />} title="Notifications">
          <SettingsToggle
            label="New client onboarded"
            desc="When an enterprise is added to your portfolio."
            on={notif.newClient}
            onChange={(v) => setNotif({ ...notif, newClient: v })}
          />
          <SettingsToggle
            label="Client low-minutes"
            desc="When a client's pool runs low."
            on={notif.lowMinutes}
            onChange={(v) => setNotif({ ...notif, lowMinutes: v })}
          />
          <SettingsToggle
            label="Payout processed"
            desc="When a commission payout is sent."
            on={notif.payout}
            onChange={(v) => setNotif({ ...notif, payout: v })}
          />
          <div className="mt-3">
            <Button size="sm" disabled={savingPrefs} onClick={savePrefs}>
              {savingPrefs ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </SettingsSection>

        {note && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {note}
          </p>
        )}
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add internal user"
        description="A teammate who helps manage your client portfolio."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setInviteOpen(false)}
              disabled={inviteBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={addMember}
              iconLeft={<Mail size={14} />}
              disabled={inviteBusy}
            >
              {inviteBusy ? "Adding…" : "Add"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Full name"
            value={iName}
            onChange={(e) => setIName(e.target.value)}
            placeholder="Sam Lee"
          />
          <Input
            label="Email"
            type="email"
            value={iEmail}
            onChange={(e) => setIEmail(e.target.value)}
            placeholder="sam@partner.com"
            required
          />
          <label
            className="flex flex-col gap-1.5 text-sm"
            style={{ color: "var(--text)" }}
          >
            Role
            <select
              value={iRole}
              onChange={(e) => setIRole(e.target.value as TeamMember["role"])}
              className="h-11 rounded-lg border px-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--background)",
                color: "var(--text)",
              }}
            >
              <option value="manager">Manager</option>
              <option value="analyst">Analyst</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {inviteError && (
            <p className="text-xs" style={{ color: "var(--risk)" }}>
              {inviteError}
            </p>
          )}
        </div>
      </Modal>
    </TabBody>
  );
}

function humanizeTeamError(code: string | undefined): string {
  switch (code) {
    case "invalid_email":
      return "That doesn't look like a valid email.";
    case "is_owner":
      return "You're already the account owner.";
    case "already_in_team":
      return "That email is already on the team.";
    case "user_in_other_reseller":
      return "That user already belongs to another partner.";
    case "not_signed_in":
      return "Your session expired. Sign in again.";
    case "forbidden":
      return "You don't have permission to add team members.";
    default:
      return code ? `Couldn't add member (${code}).` : "Couldn't add member.";
  }
}
