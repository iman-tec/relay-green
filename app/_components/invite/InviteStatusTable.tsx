"use client";

/*
 * Shared invite status table — sent / opened / accepted / expired / revoked,
 * with resend + revoke. Reads /api/invite (scoped to the caller server-side).
 * Reused by every flow alongside InviteFlow.
 *
 * Subscribes to public.invites via Realtime so the table updates the
 * instant the trg_mark_invites_accepted_on_signin trigger flips a row to
 * 'accepted'. RLS on invites scopes events to the inviter (or super_admin),
 * so we don't see other partners' rows.
 */

import { useEffect, useState } from "react";
import { RotateCw, Ban, Loader2, Inbox } from "lucide-react";
import { StatusBadge, EmptyState } from "@/app/_components/ui";
import { useApiData } from "@/app/(staff)/enterprise/v2/_shared";
import { createClient } from "@/lib/supabase/browser";

type Invite = {
  id: string; email: string; name: string | null; role: string | null;
  company_name: string | null; status: string;
  sent_at: string; opened_at: string | null; accepted_at: string | null; expires_at: string;
};

const TONE: Record<string, "ok" | "warn" | "risk" | "neutral" | "info"> = {
  accepted: "ok", opened: "info", sent: "warn", expired: "neutral", revoked: "risk",
};

export function InviteStatusTable({ reloadKey = 0 }: { reloadKey?: number }) {
  // reloadKey is a cache-buster: bumping it changes the url so useApiData refetches.
  const { data, loading, error, reload } = useApiData<{ invites: Invite[] }>(`/api/invite?r=${reloadKey}`);
  const rows = data?.invites ?? [];
  const [acting, setActing] = useState<string | null>(null);

  // Realtime: refetch whenever any visible-to-us invite row changes.
  // The trg_mark_invites_accepted_on_signin trigger fires on the recipient's
  // sign-in and updates status to 'accepted'; that UPDATE arrives here as a
  // postgres_changes event and we re-pull /api/invite to render the new state.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("invite-status-table")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invites" },
        () => { reload(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  const act = async (id: string, method: "PATCH" | "DELETE") => {
    setActing(id);
    try { await fetch(`/api/invite/${id}`, { method }); reload(); }
    finally { setActing(null); }
  };

  if (loading) return <div className="flex items-center gap-2 py-8 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={16} className="animate-spin" /> Loading invites…</div>;
  if (error) return <p className="py-6 text-sm" style={{ color: "var(--text-muted)" }}>{error}</p>;
  if (rows.length === 0) return <EmptyState compact icon={<Inbox size={18} />} title="No invites yet" body="Invites you send appear here with their status." />;

  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <th className="px-4 py-2.5 text-left font-medium">Recipient</th>
            <th className="px-4 py-2.5 text-left font-medium">Status</th>
            <th className="px-4 py-2.5 text-left font-medium">Sent</th>
            <th className="px-4 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="px-4 py-3">
                <div className="truncate" style={{ color: "var(--text)" }}>{r.company_name || r.name || r.email}</div>
                <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{r.email}</div>
              </td>
              <td className="px-4 py-3"><StatusBadge compact tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusBadge></td>
              <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{new Date(r.sent_at).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1.5">
                  {r.status !== "accepted" && r.status !== "revoked" && (
                    <>
                      <button type="button" disabled={acting === r.id} onClick={() => act(r.id, "PATCH")} title="Resend"
                        className="inline-flex size-7 items-center justify-center rounded-md border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                        <RotateCw size={13} />
                      </button>
                      <button type="button" disabled={acting === r.id} onClick={() => act(r.id, "DELETE")} title="Revoke"
                        className="inline-flex size-7 items-center justify-center rounded-md border" style={{ borderColor: "var(--border)", color: "var(--risk)" }}>
                        <Ban size={13} />
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
