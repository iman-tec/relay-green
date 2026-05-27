"use client";

/*
 * Members — org-wide member roster (enterprise admin sees own-org member
 * names/emails: allowed PII for the controller). Invite by email + role,
 * seat usage. Deactivate via the admin route the v2 panel already uses.
 */

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button, StatusBadge, Avatar, EmptyState } from "@/app/_components/ui";
import { InviteFlow } from "@/app/_components/invite/InviteFlow";
import { InviteStatusTable } from "@/app/_components/invite/InviteStatusTable";
import { useApiData, num, TabBody, LoadingState, ErrorState } from "./_shared";

type Member = {
  id: string; displayName: string; email: string;
  roles: string[]; primaryRole: string; isStaff: boolean;
  status: string; lastSignIn: string | null; createdAt: string;
};

const ROLE_OPTIONS = [
  { value: "client", label: "Member" },
  { value: "enterprise_admin", label: "Enterprise admin" },
];

export function MembersTab() {
  const { data, loading, error, reload } = useApiData<{ members: Member[] }>("/api/enterprise/users?scope=users");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteKey, setInviteKey] = useState(0);

  const members = data?.members ?? [];

  return (
    <TabBody>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-medium" style={{ color: "var(--text)" }}>Members</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {num(members.length)} member{members.length === 1 ? "" : "s"} in your organization
          </p>
        </div>
        <Button iconLeft={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>Invite</Button>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : members.length === 0 ? (
        <EmptyState icon={<UserPlus size={20} />} title="No members yet" body="Invite your first team member by email." action={<Button onClick={() => setInviteOpen(true)}>Invite a member</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr style={{ color: "var(--text-muted)" }}>
                <th className="px-4 py-2.5 text-left font-medium">Member</th>
                <th className="px-4 py-2.5 text-left font-medium">Role</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar size="sm" name={m.displayName} email={m.email} />
                      <div className="min-w-0">
                        <div className="truncate" style={{ color: "var(--text)" }}>{m.displayName || "—"}</div>
                        <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                    {m.primaryRole || (m.roles[0] ?? "member")}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge compact tone={m.status === "active" ? "ok" : "warn"}>{m.status}</StatusBadge>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                    {new Date(m.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-lg font-medium" style={{ color: "var(--text)" }}>Invitations</h2>
        <InviteStatusTable reloadKey={inviteKey} />
      </section>

      <InviteFlow
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        variant="members"
        endpoint="/api/enterprise/users"
        title="Invite members"
        roles={ROLE_OPTIONS}
        onSent={() => { reload(); setInviteKey((k) => k + 1); }}
      />
    </TabBody>
  );
}
