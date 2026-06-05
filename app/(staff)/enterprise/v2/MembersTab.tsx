"use client";

/*
 * Members — org-wide member roster (enterprise admin sees own-org member
 * names/emails: allowed PII for the controller). Invite by email + role,
 * seat usage, per-row GDPR erasure with typed confirmation.
 *
 * Erased rows render as "Erased member" with no email and a neutral
 * status badge — the row stays so aggregate session counts and billing
 * reconciliation continue to work.
 */

import { useEffect, useState } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import { Button, StatusBadge, Avatar, EmptyState, Modal, Input } from "@/app/_components/ui";
import { InviteFlow } from "@/app/_components/invite/InviteFlow";
import { InviteStatusTable } from "@/app/_components/invite/InviteStatusTable";
import { useApiData, num, LoadingState, ErrorState } from "./_shared";
import { TabBody, TabTitle, PrimaryButton } from "./_kit";
import { createClient } from "@/lib/supabase/browser";

type Member = {
  id: string; displayName: string; email: string;
  roles: string[]; primaryRole: string; isStaff: boolean;
  status: string; lastSignIn: string | null; createdAt: string;
  erasedAt: string | null;
};

const ROLE_OPTIONS = [
  { value: "client", label: "Member" },
  { value: "enterprise_admin", label: "Enterprise admin" },
];

const ERASE_CONFIRM_WORD = "ERASE";

export function MembersTab() {
  const { data, loading, error, reload } = useApiData<{ members: Member[] }>("/api/enterprise/users?scope=users");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteKey, setInviteKey] = useState(0);

  // Realtime: a member's status (invited → active) is derived from their
  // last_sign_in_at, which the client can't subscribe to directly. But the
  // SAME sign-in fires trg_mark_invites_accepted_on_signin, flipping their
  // invites row — and invites IS in the realtime publication. So we listen
  // for invite changes and re-fetch the roster: by the time the invite
  // event arrives, last_sign_in_at is already written, so the member shows
  // as active without a manual refresh.
  //
  // RLS note: invite realtime events reach the admin who SENT the invite
  // (invited_by = auth.uid()). A co-admin who didn't send a given invite
  // won't get its event — that case still needs a manual refresh until the
  // invites SELECT policy is broadened to org scope.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("enterprise-members-roster")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invites" },
        () => { reload(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  // Erasure modal state.
  const [eraseTarget, setEraseTarget] = useState<Member | null>(null);
  const [eraseConfirm, setEraseConfirm] = useState("");
  const [eraseBusy, setEraseBusy] = useState(false);
  const [eraseErr, setEraseErr] = useState<string | null>(null);

  const openErase = (m: Member) => { setEraseTarget(m); setEraseConfirm(""); setEraseErr(null); };
  const closeErase = () => { setEraseTarget(null); setEraseConfirm(""); setEraseErr(null); };

  const confirmErase = async () => {
    if (!eraseTarget) return;
    if (eraseConfirm !== ERASE_CONFIRM_WORD) {
      setEraseErr(`Type ${ERASE_CONFIRM_WORD} exactly to confirm.`);
      return;
    }
    setEraseBusy(true); setEraseErr(null);
    try {
      const res = await fetch(`/api/enterprise/members/${eraseTarget.id}/erase`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setEraseErr(humaniseEraseError(body.error));
        return;
      }
      closeErase();
      reload();
    } catch (e) {
      setEraseErr(e instanceof Error ? e.message : "Couldn't erase member.");
    } finally {
      setEraseBusy(false);
    }
  };

  const members = data?.members ?? [];

  return (
    <TabBody>
      <div className="mb-1 flex items-start justify-between gap-3">
        <TabTitle
          title="Members"
          sub={`${num(members.length)} member${members.length === 1 ? "" : "s"} in your organization`}
        />
        <PrimaryButton icon={<UserPlus size={14} />} onClick={() => setInviteOpen(true)}>Invite</PrimaryButton>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : members.length === 0 ? (
        <EmptyState icon={<UserPlus size={20} />} title="No members yet" body="Invite your first team member by email." action={<Button onClick={() => setInviteOpen(true)}>Invite a member</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-[11px] tracking-wider uppercase" style={{ color: "var(--text-muted)" }}>
                <th className="px-4 py-2.5 text-left font-medium">Member</th>
                <th className="px-4 py-2.5 text-left font-medium">Role</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Joined</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const erased = Boolean(m.erasedAt);
                return (
                  <tr key={m.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar size="sm" name={erased ? "?" : m.displayName} email={erased ? undefined : m.email} />
                        <div className="min-w-0">
                          <div
                            className="truncate"
                            style={{
                              color: erased ? "var(--text-muted)" : "var(--text)",
                              fontStyle: erased ? "italic" : undefined,
                            }}
                          >
                            {erased ? "Erased member" : (m.displayName || "—")}
                          </div>
                          <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                            {erased ? `erased ${new Date(m.erasedAt!).toLocaleDateString()}` : m.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {m.primaryRole || (m.roles[0] ?? "member")}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        compact
                        tone={erased ? "neutral" : m.status === "active" ? "ok" : "warn"}
                      >
                        {m.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        {!erased && (
                          <button
                            type="button"
                            onClick={() => openErase(m)}
                            title="Erase member (GDPR right-to-erasure)"
                            aria-label={`Erase ${m.displayName || m.email}`}
                            className="inline-flex size-7 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-raised)]"
                            style={{ borderColor: "var(--border)", color: "var(--risk)" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-8">
        <h2
          className="mb-3 text-[12px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Invitations
        </h2>
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

      <Modal
        open={Boolean(eraseTarget)}
        onClose={eraseBusy ? () => {} : closeErase}
        title="Erase member"
        description={
          eraseTarget
            ? `This permanently removes ${eraseTarget.displayName || eraseTarget.email}'s name, avatar and email visibility. Session counts and billing reconciliation stay intact, but their identity is stripped from the platform.`
            : ""
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeErase} disabled={eraseBusy}>Cancel</Button>
            <Button
              onClick={confirmErase}
              disabled={eraseBusy || eraseConfirm !== ERASE_CONFIRM_WORD}
              iconLeft={<Trash2 size={14} />}
            >
              {eraseBusy ? "Erasing…" : "Erase member"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            This action can&apos;t be undone. Type <strong style={{ color: "var(--text)" }}>{ERASE_CONFIRM_WORD}</strong> below to confirm.
          </p>
          <Input
            label={`Type "${ERASE_CONFIRM_WORD}" to confirm`}
            value={eraseConfirm}
            onChange={(e) => setEraseConfirm(e.target.value)}
            placeholder={ERASE_CONFIRM_WORD}
            autoFocus
          />
          {eraseErr && <p className="text-xs" style={{ color: "var(--risk)" }}>{eraseErr}</p>}
        </div>
      </Modal>
    </TabBody>
  );
}

function humaniseEraseError(code: string | undefined): string {
  switch (code) {
    case "cannot_erase_self": return "You can't erase your own account from here.";
    case "not_found":         return "That member is no longer in your organisation.";
    case "missing_id":        return "Couldn't identify the member to erase.";
    case "not_signed_in":     return "Your session expired. Sign in again.";
    case "forbidden":         return "You don't have permission to erase members.";
    default:                  return code ? `Couldn't erase (${code}).` : "Couldn't erase member.";
  }
}
