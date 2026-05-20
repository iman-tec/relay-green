"use client";

/*
 * Super Admin user management.
 *
 * Staff tab — paginated, searchable, sortable, role-filterable. Backed by
 * /api/admin/users with the standard list-query contract; renders via the
 * shared <DataTable>. Per-row actions: resend invite, deactivate/reactivate,
 * delete. "Add user" opens a tight inline form above the table.
 *
 * Enterprise + Pods tabs live in their own files.
 */

import { useEffect, useState } from "react";
import { Mail, Trash2, Power, PowerOff, Plus, X, CheckCircle2, Pencil } from "lucide-react";
import { useConfirmDialog } from "@/app/_components/ConfirmDialog";
import { EnterpriseTab } from "./EnterpriseTab";
import { PodsTab } from "./PodsTab";
import { formatRole } from "@/lib/relay/role-labels";
import { ROLE } from "@/lib/relay/roles";
import { DataTable, type Column } from "@/app/_components/DataTable";
import { useListQuery } from "@/lib/hooks/useListQuery";

type UserRow = {
  id:                  string;
  email:               string;
  displayName:         string;
  roles:               string[];
  primaryRole:         string | null;
  status:              "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn: boolean;
  createdAt:           string;
};

type Tab = "staff" | "users" | "enterprise" | "pods";

// Roles super_admin can create/assign from the user-admin console.
// Mirrors CREATABLE_ROLES in app/api/admin/users/route.ts — enterprise-side
// roles (enterprise_admin, department_admin) are created elsewhere.
type RoleKey = typeof ROLE.engineer | typeof ROLE.supervisor | typeof ROLE.super_admin;

const CREATABLE_ROLES: { value: RoleKey; label: string }[] = [
  { value: ROLE.engineer,    label: formatRole(ROLE.engineer) },
  { value: ROLE.supervisor,  label: formatRole(ROLE.supervisor) },
  { value: ROLE.super_admin, label: formatRole(ROLE.super_admin) },
];

const ALL_FILTERABLE_ROLES = [
  { value: ROLE.engineer,         label: formatRole(ROLE.engineer) },
  { value: ROLE.supervisor,       label: formatRole(ROLE.supervisor) },
  { value: ROLE.enterprise_admin, label: formatRole(ROLE.enterprise_admin) },
  { value: ROLE.super_admin,      label: formatRole(ROLE.super_admin) },
];

const BRAND_GREEN = "#3f5c2e";
const NEW_POD_KEY = "__new_pod__";

export function UsersClient({ meEmail }: { meEmail: string }) {
  const [tab, setTab] = useState<Tab>("staff");

  return (
    <main
      className="min-h-screen px-6 py-8"
      style={{ backgroundColor: "var(--background)" }}
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>Users</h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
              Signed in as <span style={{ color: "var(--text)" }}>{meEmail}</span>
            </p>
          </div>
        </header>

        <Tabs tab={tab} setTab={setTab} />

        {tab === "staff"      && <StaffTab meEmail={meEmail} />}
        {tab === "users"      && <CustomerTab />}
        {tab === "enterprise" && <EnterpriseTab />}
        {tab === "pods"       && <PodsTab />}
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: "staff",      label: "Internal staff" },
    { id: "users",      label: "Users" },
    { id: "enterprise", label: "Enterprise customers" },
    { id: "pods",       label: "Pods" },
  ];
  return (
    <div className="mb-4 flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
      {items.map((it) => {
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => setTab(it.id)}
            className="px-3 py-2 text-sm font-medium transition-colors"
            style={{
              color: active ? "var(--text)" : "var(--text-muted)",
              borderBottom: `2px solid ${active ? BRAND_GREEN : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function StaffTab({ meEmail }: { meEmail: string }) {
  const list = useListQuery<UserRow>("/api/admin/users", {
    pageSize: 10,
    sort:     { column: "displayName", dir: "asc" },
    filters:  ["role"],
    fixedParams: { scope: "staff" },
  });

  /** When podId is set, the new user gets auto-assigned to that pod after
   *  invite. When podId === NEW_POD_KEY, we create a pod named `newPodName`
   *  first, then assign the user to it. */
  const [draft, setDraft] = useState<{
    email: string;
    displayName: string;
    role: RoleKey;
    podId: string | null;       // null = no pod; uuid = existing; NEW_POD_KEY = create new
    newPodName: string;
  } | null>(null);
  const [pods, setPods] = useState<{ id: string; name: string }[]>([]);
  const [podsLoaded, setPodsLoaded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo,  setActionInfo]  = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const confirmDialog = useConfirmDialog();

  // Auto-dismiss the green success toast after 3s.
  useEffect(() => {
    if (!actionInfo) return;
    const t = setTimeout(() => setActionInfo(null), 3000);
    return () => clearTimeout(t);
  }, [actionInfo]);
  /** When set, the user with this id has their Role cell swapped to a dropdown. */
  const [editingRoleFor, setEditingRoleFor] = useState<string | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);

  const saveRole = async (id: string, role: RoleKey) => {
    setRoleSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ role }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setActionError(body.error ?? "Role update failed."); return; }
      setEditingRoleFor(null);
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Role update failed.");
    } finally {
      setRoleSaving(false);
    }
  };

  const ensurePodsLoaded = async () => {
    if (podsLoaded) return;
    try {
      const res = await fetch("/api/admin/pods", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { pods?: { id: string; name: string }[] };
      setPods(body.pods ?? []);
    } catch { /* silent — pod field falls back to "None" */ } finally {
      setPodsLoaded(true);
    }
  };

  const startAdd  = () => {
    void ensurePodsLoaded();
    setDraft({ email: "", displayName: "", role: ROLE.engineer, podId: null, newPodName: "" });
  };
  const cancelAdd = () => setDraft(null);

  const submitAdd = async () => {
    if (!draft || submitting) return;
    const email       = draft.email.trim().toLowerCase();
    const displayName = draft.displayName.trim();
    if (!email || !displayName) {
      setActionError("Email and name are required.");
      return;
    }
    setActionError(null);
    setActionInfo(null);
    setSubmitting(true);
    try {
      // 1. (optional) Create a new pod if the user chose "Create new pod".
      let podId: string | null = draft.podId;
      if (podId === NEW_POD_KEY) {
        const name = draft.newPodName.trim();
        if (!name) {
          setActionError("New pod needs a name.");
          return;
        }
        const podRes = await fetch("/api/admin/pods", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ name }),
        });
        const podBody = (await podRes.json().catch(() => ({}))) as { pod?: { id: string; name: string }; error?: string };
        if (!podRes.ok || !podBody.pod?.id) {
          setActionError(podBody.error ?? "Couldn't create pod.");
          return;
        }
        podId = podBody.pod.id;
        setPods((prev) => [...prev, podBody.pod!]);
      }

      // 2. Invite the user. Pod context (name + pod_role) goes through as
      //    user_metadata so the Supabase invite template can mention which
      //    pod and role they were invited as (bugs2.txt #1).
      const podRoleFor: "engineer" | "supervisor" | null =
        draft.role === ROLE.engineer   ? "engineer"   :
        draft.role === ROLE.supervisor ? "supervisor" : null;
      const podName = podId
        ? (pods.find((p) => p.id === podId)?.name ?? null)
        : null;
      const res = await fetch("/api/admin/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          email,
          displayName,
          role: draft.role,
          podName,
          podRole: podRoleFor,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        user?:             { id: string };
        invited?:          boolean;
        attachedExisting?: boolean;
        error?:            string;
      };
      if (!res.ok || !body.user?.id) {
        setActionError(body.error ?? "Couldn't create user.");
        return;
      }
      const userId = body.user.id;

      // 3. Assign to the pod (only engineer + supervisor are pod-eligible).
      if (podId && podRoleFor) {
        const assignRes = await fetch(`/api/admin/pods/${podId}/members`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ userId, podRole: podRoleFor }),
        });
        const assignBody = (await assignRes.json().catch(() => ({}))) as { error?: string };
        if (!assignRes.ok) {
          setActionError(`User invited, but pod assignment failed: ${assignBody.error ?? "unknown error"}`);
        }
      }

      // Tailor the toast to whether we actually mailed someone (new user)
      // vs. silently attached an existing user (bugs2.txt #1 — no more
      // OTP-looking emails for already-active accounts).
      const podSuffix = podName ? ` to ${podName}` : "";
      setActionInfo(
        body.attachedExisting
          ? `${email} already had an account — attached${podSuffix}.`
          : `Invitation email sent to ${email}${podSuffix}.`,
      );
      setDraft(null);
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't create user.");
    } finally {
      setSubmitting(false);
    }
  };

  const resendInvite = async (row: UserRow) => {
    const ok = await confirmDialog.ask({
      title:        "Resend sign-in email?",
      message:      `${row.email} will get a fresh magic-link email.`,
      confirmLabel: "Send invite",
      tone:         "neutral",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/users/${row.id}/resend-invite`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setActionError(body.error ?? "Resend failed."); return; }
      setActionInfo(`Sign-in email resent to ${row.email}.`);
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Resend failed.");
    }
  };

  const toggleStatus = async (row: UserRow) => {
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: row.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setActionError(body.error ?? "Update failed."); return; }
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const deleteRow = async (row: UserRow) => {
    const ok = await confirmDialog.ask({
      title:        "Delete user?",
      message:      `${row.email} will be permanently removed — auth record, profile, and roles included.`,
      confirmLabel: "Delete",
      tone:         "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setActionError(body.error ?? "Delete failed."); return; }
      setActionInfo(`Deleted ${row.email}.`);
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const columns: Column<UserRow>[] = [
    {
      key: "displayName", header: "Name", sortable: true,
      render: (r) => (
        <span style={{ color: "var(--text)" }}>{r.displayName || "—"}</span>
      ),
    },
    {
      key: "email", header: "Email",
      render: (r) => (
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{r.email}</span>
      ),
    },
    {
      key: "primaryRole", header: "Role", sortable: true,
      render: (r) => {
        const isSelf = r.email.toLowerCase() === meEmail.toLowerCase();
        const isSuper = (r.primaryRole ?? r.roles[0]) === ROLE.super_admin;
        const editable = !isSelf && !isSuper;
        if (editingRoleFor === r.id) {
          return (
            <RoleSelect
              initial={(r.primaryRole as RoleKey) ?? ROLE.engineer}
              disabled={roleSaving}
              onCommit={(next) => { void saveRole(r.id, next); }}
              onCancel={() => setEditingRoleFor(null)}
            />
          );
        }
        return (
          <button
            type="button"
            onClick={() => editable && setEditingRoleFor(r.id)}
            disabled={!editable}
            className="group inline-flex cursor-pointer items-center gap-1.5 rounded-md transition-opacity hover:opacity-90 disabled:cursor-default disabled:hover:opacity-100"
            title={editable ? "Click to change role" : undefined}
          >
            <RoleChip role={r.primaryRole ?? r.roles[0] ?? "—"} />
            {editable && (
              <Pencil
                size={11}
                style={{ color: BRAND_GREEN }}
                className="opacity-60 transition-opacity group-hover:opacity-100"
              />
            )}
          </button>
        );
      },
    },
    {
      key: "status", header: "Status",
      render: (r) => (
        <StatusChip status={r.status} awaitingFirstSignIn={r.awaitingFirstSignIn} />
      ),
    },
    {
      key: "actions", header: "Actions", align: "right",
      render: (r) => {
        const isSelf  = r.email.toLowerCase() === meEmail.toLowerCase();
        if (isSelf) return <span className="text-xs" style={{ color: "var(--text-muted)" }}>(you)</span>;
        const isSuper = (r.primaryRole ?? r.roles[0]) === ROLE.super_admin;
        return (
          <div className="inline-flex items-center gap-1">
            <IconAction onClick={() => void resendInvite(r)} title="Resend invitation email" icon={<Mail size={14} />} />
            <IconAction
              onClick={() => void toggleStatus(r)}
              title={r.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
              icon={r.status === "ACTIVE" ? <Power size={14} /> : <PowerOff size={14} />}
            />
            <IconAction
              onClick={() => { if (!isSuper) void deleteRow(r); }}
              title={isSuper ? "Super Admins can't be deleted from here" : "Delete"}
              icon={<Trash2 size={14} />}
              danger
              disabled={isSuper}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {actionError && <ErrorBanner message={actionError} dismiss={() => setActionError(null)} />}
      {actionInfo  && <SuccessToast message={actionInfo} dismiss={() => setActionInfo(null)} />}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={startAdd}
          disabled={!!draft}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          <Plus size={12} /> Add user
        </button>
      </div>

      {draft && (
        <DraftForm
          draft={draft}
          setDraft={setDraft}
          pods={pods}
          cancel={cancelAdd}
          submit={submitAdd}
          submitting={submitting}
        />
      )}

      <DataTable
        list={list}
        columns={columns}
        getRowKey={(r) => r.id}
        searchPlaceholder="Search staff by name…"
        filters={[
          {
            key: "role",
            label: "All roles",
            options: ALL_FILTERABLE_ROLES,
          },
        ]}
        emptyText="No staff yet. Click Add user to invite someone."
      />
      {confirmDialog.element}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

// ── Users tab: signed-up customers (anyone without a staff role) ──────────
function CustomerTab() {
  const list = useListQuery<UserRow>("/api/admin/users", {
    pageSize: 10,
    sort:     { column: "createdAt", dir: "desc" },
    fixedParams: { scope: "customer" },
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo,  setActionInfo]  = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useEffect(() => {
    if (!actionInfo) return;
    const t = setTimeout(() => setActionInfo(null), 3000);
    return () => clearTimeout(t);
  }, [actionInfo]);

  const toggleStatus = async (row: UserRow) => {
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: row.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setActionError(body.error ?? "Update failed."); return; }
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const deleteRow = async (row: UserRow) => {
    const ok = await confirmDialog.ask({
      title:        "Delete user?",
      message:      `${row.email} will be permanently removed — auth record, profile, and any sessions included.`,
      confirmLabel: "Delete",
      tone:         "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setActionError(body.error ?? "Delete failed."); return; }
      setActionInfo(`Deleted ${row.email}.`);
      await list.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const columns: Column<UserRow>[] = [
    {
      key: "displayName", header: "Name", sortable: true,
      render: (r) => <span style={{ color: "var(--text)" }}>{r.displayName || "—"}</span>,
    },
    {
      key: "email", header: "Email",
      render: (r) => (
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{r.email || "—"}</span>
      ),
    },
    {
      key: "createdAt", header: "Signed up", sortable: true,
      render: (r) => (
        <span style={{ color: "var(--text-muted)" }}>
          {r.createdAt
            ? new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : "—"}
        </span>
      ),
    },
    {
      key: "status", header: "Status",
      render: (r) => <StatusChip status={r.status} />,
    },
    {
      key: "actions", header: "Actions", align: "right",
      render: (r) => (
        <div className="inline-flex items-center gap-1">
          <IconAction
            onClick={() => void toggleStatus(r)}
            title={r.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            icon={r.status === "ACTIVE" ? <Power size={14} /> : <PowerOff size={14} />}
          />
          <IconAction
            onClick={() => void deleteRow(r)}
            title="Delete"
            icon={<Trash2 size={14} />}
            danger
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {actionError && <ErrorBanner message={actionError} dismiss={() => setActionError(null)} />}
      {actionInfo  && <SuccessToast message={actionInfo} dismiss={() => setActionInfo(null)} />}

      <DataTable
        list={list}
        columns={columns}
        getRowKey={(r) => r.id}
        searchPlaceholder="Search users by name…"
        emptyText="No customer signups yet."
      />
      {confirmDialog.element}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function DraftForm({
  draft, setDraft, pods, cancel, submit, submitting,
}: {
  draft: { email: string; displayName: string; role: RoleKey; podId: string | null; newPodName: string };
  setDraft: (d: { email: string; displayName: string; role: RoleKey; podId: string | null; newPodName: string }) => void;
  pods: { id: string; name: string }[];
  cancel: () => void;
  submit: () => void;
  submitting: boolean;
}) {
  const onKey = (e: React.KeyboardEvent) => {
    if (submitting) return;
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Escape") cancel();
  };
  // Pod is only meaningful for pod-eligible roles. For super_admin the
  // dropdown disables itself; super_admin assignments never write to
  // pod_members.
  const podEligible = draft.role === ROLE.engineer || draft.role === ROLE.supervisor;
  const podSelectValue = draft.podId ?? "";
  const showNewPodInput = draft.podId === NEW_POD_KEY;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{
        borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 4%, var(--surface))",
      }}
    >
      <div className="grid gap-2 md:grid-cols-[1.4fr_1.4fr_1fr_1fr]">
        <input
          autoFocus
          type="text"
          placeholder="Full name"
          value={draft.displayName}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          onKeyDown={onKey}
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        />
        <input
          type="email"
          placeholder="email@company.com"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          onKeyDown={onKey}
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        />
        <select
          value={draft.role}
          onChange={(e) => {
            const next = e.target.value as RoleKey;
            // Reset pod selection when role becomes pod-ineligible.
            const clearPod = next !== ROLE.engineer && next !== ROLE.supervisor;
            setDraft({
              ...draft,
              role: next,
              podId: clearPod ? null : draft.podId,
              newPodName: clearPod ? "" : draft.newPodName,
            });
          }}
          onKeyDown={onKey}
          className="rounded-md border px-2 py-1.5 text-sm outline-none"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            color: "var(--text)",
          }}
        >
          {CREATABLE_ROLES.map((r) => (
            <option key={r.value} value={r.value} style={{ backgroundColor: "var(--surface)", color: "var(--text)" }}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={podSelectValue}
          disabled={!podEligible}
          onChange={(e) => {
            const v = e.target.value;
            setDraft({
              ...draft,
              podId: v === "" ? null : v,
              newPodName: v === NEW_POD_KEY ? draft.newPodName : "",
            });
          }}
          onKeyDown={onKey}
          className="rounded-md border px-2 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            color: "var(--text)",
          }}
          title={podEligible ? "Assign to a pod" : "Pods only apply to engineers and supervisors"}
        >
          <option value="">{podEligible ? "No pod" : "—"}</option>
          {pods.map((p) => (
            <option key={p.id} value={p.id} style={{ backgroundColor: "var(--surface)", color: "var(--text)" }}>
              {p.name}
            </option>
          ))}
          {podEligible && (
            <option value={NEW_POD_KEY} style={{ backgroundColor: "var(--surface)", color: BRAND_GREEN }}>
              + Create new pod…
            </option>
          )}
        </select>
      </div>

      {showNewPodInput && podEligible && (
        <input
          autoFocus
          type="text"
          placeholder="New pod name (e.g. Pod Gamma)"
          value={draft.newPodName}
          onChange={(e) => setDraft({ ...draft, newPodName: e.target.value })}
          onKeyDown={onKey}
          className="rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none"
          style={{ borderColor: BRAND_GREEN, color: "var(--text)" }}
        />
      )}

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {submitting && (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/70 border-t-transparent"
              aria-hidden
            />
          )}
          {submitting ? "Sending invite…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={submitting}
          className="rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SuccessToast({ message, dismiss }: { message: string; dismiss: () => void }) {
  return (
    <div
      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color:           BRAND_GREEN,
        borderColor:     "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
        animation:       "relay-toast-in 180ms ease-out",
      }}
    >
      <span className="inline-flex items-center gap-2">
        <CheckCircle2 size={14} />
        {message}
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-md p-1">
        <X size={14} />
      </button>
    </div>
  );
}

function ErrorBanner({ message, dismiss }: { message: string; dismiss: () => void }) {
  return (
    <div
      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
      style={{
        backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
        color: "var(--accent-red)",
        borderColor: "color-mix(in srgb, var(--accent-red) 25%, transparent)",
      }}
    >
      <span>{message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-md p-1">
        <X size={14} />
      </button>
    </div>
  );
}

function RoleSelect({
  initial, disabled, onCommit, onCancel,
}: {
  initial: RoleKey;
  disabled?: boolean;
  onCommit: (role: RoleKey) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<RoleKey>(initial);
  return (
    <select
      autoFocus
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const next = e.target.value as RoleKey;
        setValue(next);
        if (next !== initial) onCommit(next);
      }}
      onBlur={() => {
        // Cancel if user opened the dropdown without picking anything new.
        if (value === initial) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="rounded-md border px-2 py-1 text-xs outline-none"
      style={{
        borderColor: BRAND_GREEN,
        backgroundColor: "var(--background)",
        color: "var(--text)",
      }}
    >
      {CREATABLE_ROLES.map((r) => (
        <option key={r.value} value={r.value} style={{ backgroundColor: "var(--surface)", color: "var(--text)" }}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

function RoleChip({ role }: { role: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      {formatRole(role)}
    </span>
  );
}

function StatusChip({
  status,
}: {
  status: "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn?: boolean;
}) {
  if (status === "DEACTIVATED") {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        Deactivated
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      Active
    </span>
  );
}

function IconAction({
  onClick, title, icon, danger, disabled,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 transition-colors hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/[0.05]"
      style={{ color: danger ? "var(--accent-red)" : "var(--text-muted)" }}
    >
      {icon}
    </button>
  );
}
