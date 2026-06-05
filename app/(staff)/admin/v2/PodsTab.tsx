"use client";

/*
 * Pods tab — single sidebar + main area.
 *
 *   Sidebar: pods (with engineer + supervisor counts; no minutes since
 *            pods are staff-only — internal users don't have a customer
 *            minute pool).
 *   Main:    pod detail card → supervisor section → engineers table.
 *
 * Same patterns as the Enterprise / Reseller tabs:
 *   • Mutually-exclusive main view (no pod selected → empty state; pod
 *     selected → details + members)
 *   • Click the same pod twice = the "back" action (clears local state
 *     even though there's no deeper level to collapse from)
 *   • Shared Breadcrumb above the main area
 *   • Per-row Resend / Deactivate / Remove icons on every member
 *
 * Pod status: pods table has archived_at (nullable) instead of an
 * active/suspended status column. Archive == "deactivate"; un-archive
 * == "reactivate". The list endpoint filters archived pods out, so an
 * archived pod will simply vanish from the sidebar.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Mail, Power, PowerOff, Trash2 } from "lucide-react";
import { Sidebar } from "@/app/_components/admin-v2/Sidebar";
import { DetailCard } from "@/app/_components/admin-v2/DetailCard";
import { Breadcrumb, type Crumb } from "@/app/_components/admin-v2/Breadcrumb";
import { AddPodDrawer } from "./_drawers/AddPodDrawer";
import { PickPodMemberDrawer } from "./_drawers/PickPodMemberDrawer";

type PodMember = {
  id: string;
  userId: string;
  podRole: string;
  addedAt: string;
  email: string;
  displayName: string;
};

type Pod = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  supervisors: PodMember[];
  engineers: PodMember[];
};

type MemberAuthStatus = "active" | "suspended";

export function PodsTab() {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selPodId, setPodId] = useState<string | null>(null);

  const [addPod, setAddPod] = useState(false);
  const [addEngineer, setAddEngineer] = useState(false);
  const [addSupervisor, setAddSupervisor] = useState(false);

  // Auth-status cache for displayed pod members — pulled from listUsers.
  const [statusByUser, setStatusByUser] = useState<
    Map<string, MemberAuthStatus>
  >(new Map());

  // ─ Load pods + auth statuses ───────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pods", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        pods?: Pod[];
        error?: string;
      };
      if (!res.ok || !body.pods) {
        setError(body.error ?? "Couldn't load pods.");
        return;
      }
      setPods(body.pods);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load pods.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Resolve auth-ban status for displayed members. We piggyback on the
  // /api/admin/users list — it returns the banned flag we need.
  const selPod = pods.find((p) => p.id === selPodId) ?? null;
  useEffect(() => {
    if (!selPod) return;
    const memberIds = [...selPod.supervisors, ...selPod.engineers].map(
      (m) => m.userId
    );
    if (memberIds.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/users?limit=1000", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          users?: Array<{ id: string; status: string }>;
        };
        if (cancelled) return;
        const map = new Map<string, MemberAuthStatus>();
        for (const u of body.users ?? []) {
          // /api/admin/users returns uppercase ACTIVE / DEACTIVATED.
          map.set(u.id, u.status === "DEACTIVATED" ? "suspended" : "active");
        }
        setStatusByUser(map);
      } catch {
        /* non-fatal — status badges just won't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selPod]);

  // ─ Mutations ──────────────────────────────────────────────────────
  const archivePod = async (id: string) => {
    if (
      !confirm(
        "Archive this pod? Members will stay assigned until you remove them."
      )
    )
      return;
    const res = await fetch(`/api/admin/pods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (res.ok) {
      setPodId(null);
      refresh();
    } else
      alert((await res.json().catch(() => ({}))).error ?? "Archive failed.");
  };

  const removeMember = async (userId: string) => {
    if (!selPodId) return;
    if (!confirm("Remove this user from the pod?")) return;
    const res = await fetch(`/api/admin/pods/${selPodId}/members/${userId}`, {
      method: "DELETE",
    });
    if (res.ok) refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Remove failed.");
  };

  const resendInvite = async (userId: string) => {
    const res = await fetch(`/api/admin/users/${userId}/resend-invite`, {
      method: "POST",
    });
    if (res.ok) alert("Invite resent.");
    else alert((await res.json().catch(() => ({}))).error ?? "Resend failed.");
  };

  const toggleMemberStatus = async (
    userId: string,
    currentlyActive: boolean
  ) => {
    const next = currentlyActive ? "DEACTIVATED" : "ACTIVE";
    const verb = currentlyActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${verb} this user's sign-in access?`)) return;
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      // Patch our local status cache so the row updates immediately.
      setStatusByUser((prev) => {
        const next = new Map(prev);
        next.set(userId, currentlyActive ? "suspended" : "active");
        return next;
      });
    } else
      alert((await res.json().catch(() => ({}))).error ?? "Update failed.");
  };

  // ─ Render ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0">
      <Sidebar
        title="Pods"
        searchPlaceholder="Search pods…"
        width={280}
        items={pods.map((p) => ({
          id: p.id,
          label: p.name,
          search: `${p.name} ${p.slug} ${p.description ?? ""}`,
          _data: p,
        }))}
        selectedId={selPodId}
        onSelect={(it) => setPodId(it.id)}
        emptyMessage={loading ? "Loading…" : (error ?? "No pods yet.")}
        footer={
          <button
            type="button"
            onClick={() => setAddPod(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus className="size-3.5" /> Add Pod
          </button>
        }
        renderRow={(it) => {
          const p = (it as unknown as { _data: Pod })._data;
          const total = p.engineers.length + p.supervisors.length;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-sm font-medium"
                  style={{ color: "var(--text)" }}
                >
                  {p.name}
                </span>
                <code
                  className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    background:
                      "color-mix(in srgb, var(--text-muted) 12%, transparent)",
                    color: "var(--text-muted)",
                  }}
                >
                  {p.slug}
                </code>
              </div>
              <div
                className="flex items-center gap-1.5 text-[10px] tracking-wider uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                <span>{p.engineers.length} eng</span>
                <span>·</span>
                <span>{p.supervisors.length} sup</span>
                <span>·</span>
                <span>{total} total</span>
              </div>
            </div>
          );
        }}
      />

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Breadcrumb
          items={(() => {
            const crumbs: Crumb[] = [
              {
                label: "Pods",
                onClick: () => setPodId(null),
              },
            ];
            if (selPod) crumbs.push({ label: selPod.name });
            return crumbs;
          })()}
        />

        {!selPod && (
          <EmptyState
            title="Select a pod"
            blurb="Pick a pod on the left to view its supervisor and engineers."
          />
        )}

        {selPod && (
          <div className="flex flex-col gap-6">
            <DetailCard
              title={selPod.name}
              code={selPod.slug}
              description={selPod.description ?? undefined}
              actions={
                <button
                  type="button"
                  onClick={() => archivePod(selPod.id)}
                  className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--primary) 50%, transparent)",
                    color: "var(--primary)",
                  }}
                >
                  Archive pod
                </button>
              }
              footerHint="Pods don't have a minute pool — staff (engineers + supervisors) handle calls; minutes are tracked on the customer side."
            />

            <MemberSection
              title="Supervisors"
              role="supervisor"
              members={selPod.supervisors}
              statusByUser={statusByUser}
              onAdd={() => setAddSupervisor(true)}
              onResend={resendInvite}
              onToggleStatus={toggleMemberStatus}
              onRemove={removeMember}
            />

            <MemberSection
              title="Engineers"
              role="engineer"
              members={selPod.engineers}
              statusByUser={statusByUser}
              onAdd={() => setAddEngineer(true)}
              onResend={resendInvite}
              onToggleStatus={toggleMemberStatus}
              onRemove={removeMember}
            />
          </div>
        )}
      </main>

      <AddPodDrawer
        open={addPod}
        onClose={() => setAddPod(false)}
        onCreated={(podId) => {
          setAddPod(false);
          refresh().then(() => setPodId(podId));
        }}
      />
      <PickPodMemberDrawer
        open={addEngineer}
        podId={selPodId}
        role="engineer"
        onClose={() => setAddEngineer(false)}
        onAdded={() => {
          setAddEngineer(false);
          refresh();
        }}
      />
      <PickPodMemberDrawer
        open={addSupervisor}
        podId={selPodId}
        role="supervisor"
        onClose={() => setAddSupervisor(false)}
        onAdded={() => {
          setAddSupervisor(false);
          refresh();
        }}
      />
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function EmptyState({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div
      className="rounded-lg border border-dashed py-12 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </h3>
      <p
        className="mt-1.5 text-xs leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        {blurb}
      </p>
    </div>
  );
}

function MemberSection({
  title,
  role,
  members,
  statusByUser,
  onAdd,
  onResend,
  onToggleStatus,
  onRemove,
}: {
  title: string;
  role: "engineer" | "supervisor";
  members: PodMember[];
  statusByUser: Map<string, MemberAuthStatus>;
  onAdd: () => void;
  onResend: (id: string) => void;
  onToggleStatus: (id: string, currentlyActive: boolean) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <header
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          {title} ({members.length})
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          <Plus className="size-3.5" />
          Add {role === "engineer" ? "Engineer" : "Supervisor"}
        </button>
      </header>

      {members.length === 0 ? (
        <p className="px-4 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No {role}s assigned to this pod yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {members.map((m) => {
            const status = statusByUser.get(m.userId) ?? "active";
            return (
              <li
                key={m.id}
                className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background:
                      "color-mix(in srgb, var(--primary) 14%, transparent)",
                    color: "var(--primary)",
                  }}
                >
                  {initials(m)}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    {m.displayName || "—"}
                  </div>
                  <div
                    className="truncate text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {m.email}
                  </div>
                </div>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                  style={{
                    color:
                      status === "active" ? "#3dcb7e" : "var(--text-muted)",
                    background:
                      status === "active"
                        ? "color-mix(in srgb, #3dcb7e 14%, transparent)"
                        : "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                  }}
                >
                  {status}
                </span>
                <div className="flex items-center gap-1">
                  <RowIcon
                    title="Resend invite email"
                    onClick={() => onResend(m.userId)}
                  >
                    <Mail className="size-3.5" />
                  </RowIcon>
                  <RowIcon
                    title={status === "active" ? "Deactivate" : "Reactivate"}
                    onClick={() =>
                      onToggleStatus(m.userId, status === "active")
                    }
                  >
                    {status === "active" ? (
                      <PowerOff className="size-3.5" />
                    ) : (
                      <Power className="size-3.5" />
                    )}
                  </RowIcon>
                  <RowIcon
                    title={`Remove ${role} from pod`}
                    danger
                    onClick={() => onRemove(m.userId)}
                  >
                    <Trash2 className="size-3.5" />
                  </RowIcon>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RowIcon({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-white/5"
      style={{ color: danger ? "var(--primary)" : "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}

function initials(m: PodMember): string {
  const src = m.displayName || m.email;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}
