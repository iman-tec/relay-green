"use client";

/*
 * Super Admin user management — Excel-style inline CRUD.
 *
 * The Staff tab lists everyone with an internal role (engineer, pod_lead,
 * ops_manager, admin, super_admin). The Enterprise tab lives in
 * EnterpriseTab.tsx.
 *
 * Row interactions:
 *   - "+ Add user" appends an empty edit row at the top. On save, Supabase
 *     sends a magic-link invitation email; the user clicks it to confirm
 *     and signs in to their role's landing.
 *   - Click a cell (name or role) on an existing row to edit. Enter saves,
 *     Esc cancels. Tab moves between fields within the same row.
 *   - Right-hand actions: resend invite, deactivate/reactivate, delete.
 */

import { useEffect, useRef, useState } from "react";
import { Mail, Trash2, Power, Plus, X } from "lucide-react";
import { EnterpriseTab } from "./EnterpriseTab";
import { PodsTab } from "./PodsTab";
import { formatRole } from "@/lib/relay/role-labels";

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

type Tab = "staff" | "enterprise" | "pods";

type RoleKey = "engineer" | "pod_lead" | "ops_manager" | "admin";

const CREATABLE_ROLES: { value: RoleKey; label: string }[] = [
  { value: "engineer",    label: formatRole("engineer") },
  { value: "pod_lead",    label: formatRole("pod_lead") },
  { value: "ops_manager", label: formatRole("ops_manager") },
  { value: "admin",       label: formatRole("admin") },
];

const BRAND_GREEN = "#3f5c2e";

export function UsersClient({ meEmail }: { meEmail: string }) {
  const [tab, setTab] = useState<Tab>("staff");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ email: string; action: "invited" | "resent" } | null>(
    null,
  );
  const [draft, setDraft] = useState<{
    email: string;
    displayName: string;
    role: RoleKey;
  } | null>(null);

  // Track which cell is being edited: { id, field }. null = none.
  const [editing, setEditing] = useState<{
    id: string;
    field: "displayName" | "role";
  } | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?scope=staff`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        users?: UserRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Couldn't load users.");
        return;
      }
      setUsers(body.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, []);

  const startAdd = () => {
    setDraft({ email: "", displayName: "", role: "engineer" });
  };

  const cancelAdd = () => setDraft(null);

  const submitAdd = async () => {
    if (!draft) return;
    const email = draft.email.trim().toLowerCase();
    const displayName = draft.displayName.trim();
    if (!email || !displayName) {
      setError("Email and name are required.");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, displayName, role: draft.role }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        invited?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Couldn't create user.");
        return;
      }
      setReveal({ email, action: "invited" });
      setDraft(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create user.");
    }
  };

  const patchRow = async (id: string, patch: Partial<UserRow>) => {
    const apiPatch: Record<string, unknown> = {};
    if (patch.displayName !== undefined) apiPatch.displayName = patch.displayName;
    if (patch.primaryRole !== undefined) apiPatch.role = patch.primaryRole;
    if (patch.status !== undefined) apiPatch.status = patch.status;
    if (!Object.keys(apiPatch).length) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(apiPatch),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Update failed.");
        return;
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const resendInvite = async (row: UserRow) => {
    if (!confirm(`Send a fresh sign-in email to ${row.email}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${row.id}/resend-invite`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        resent?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Resend failed.");
        return;
      }
      setReveal({ email: row.email, action: "resent" });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resend failed.");
    }
  };

  const toggleStatus = (row: UserRow) =>
    patchRow(row.id, {
      status: row.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE",
    });

  const deleteRow = async (row: UserRow) => {
    if (
      !confirm(
        `Permanently delete ${row.email}? Their auth record, profile, and roles will be removed.`,
      )
    ) return;
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Delete failed.");
        return;
      }
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <main
      className="min-h-screen px-6 py-8"
      style={{ backgroundColor: "var(--background)" }}
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-baseline justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-semibold"
              style={{ color: "var(--text)" }}
            >
              Users
            </h1>
            <p
              className="mt-0.5 text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              Signed in as <span style={{ color: "var(--text)" }}>{meEmail}</span>
            </p>
          </div>
        </header>

        <Tabs tab={tab} setTab={setTab} />

        {reveal && <RevealBanner reveal={reveal} dismiss={() => setReveal(null)} />}
        {error && <ErrorBanner message={error} dismiss={() => setError(null)} />}

        {tab === "staff" && (
          <StaffTable
            users={users}
            loading={loading}
            draft={draft}
            setDraft={setDraft}
            startAdd={startAdd}
            cancelAdd={cancelAdd}
            submitAdd={submitAdd}
            editing={editing}
            setEditing={setEditing}
            patchRow={patchRow}
            resendInvite={resendInvite}
            toggleStatus={toggleStatus}
            deleteRow={deleteRow}
            meEmail={meEmail}
          />
        )}

        {tab === "enterprise" && <EnterpriseTab />}

        {tab === "pods" && <PodsTab />}
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: "staff",      label: "Internal staff" },
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

function RevealBanner({
  reveal,
  dismiss,
}: {
  reveal: { email: string; action: "invited" | "resent" };
  dismiss: () => void;
}) {
  return (
    <div
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border p-3"
      style={{
        borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
        backgroundColor:
          "color-mix(in srgb, " + BRAND_GREEN + " 6%, transparent)",
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
          <Mail size={14} style={{ color: BRAND_GREEN }} />
          <span>
            {reveal.action === "invited" ? "Invitation sent" : "New sign-in link sent"} to{" "}
            <strong>{reveal.email}</strong>. They&apos;ll click the magic link to sign in.
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md p-1.5 text-xs"
          style={{ color: "var(--text-muted)" }}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  dismiss,
}: {
  message: string;
  dismiss: () => void;
}) {
  return (
    <div
      className="mb-4 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--accent-red) 8%, transparent)",
        color: "var(--accent-red)",
        borderColor:
          "color-mix(in srgb, var(--accent-red) 25%, transparent)",
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded-md p-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function StaffTable({
  users,
  loading,
  draft,
  setDraft,
  startAdd,
  cancelAdd,
  submitAdd,
  editing,
  setEditing,
  patchRow,
  resendInvite,
  toggleStatus,
  deleteRow,
  meEmail,
}: {
  users: UserRow[];
  loading: boolean;
  draft: { email: string; displayName: string; role: RoleKey } | null;
  setDraft: (d: { email: string; displayName: string; role: RoleKey } | null) => void;
  startAdd: () => void;
  cancelAdd: () => void;
  submitAdd: () => void;
  editing: { id: string; field: "displayName" | "role" } | null;
  setEditing: (e: { id: string; field: "displayName" | "role" } | null) => void;
  patchRow: (id: string, patch: Partial<UserRow>) => Promise<void>;
  resendInvite: (row: UserRow) => void;
  toggleStatus:   (row: UserRow) => void;
  deleteRow:      (row: UserRow) => void;
  meEmail: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {users.length} staff member{users.length === 1 ? "" : "s"}
        </p>
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

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {draft && (
            <DraftRow
              draft={draft}
              setDraft={setDraft}
              cancel={cancelAdd}
              submit={submitAdd}
            />
          )}

          {loading && !users.length && (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-8 text-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                Loading…
              </td>
            </tr>
          )}

          {!loading && !users.length && !draft && (
            <tr>
              <td
                colSpan={5}
                className="px-3 py-8 text-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                No staff yet. Click <strong>Add user</strong> to create one.
              </td>
            </tr>
          )}

          {users.map((u) => (
            <BodyRow
              key={u.id}
              row={u}
              editing={editing}
              setEditing={setEditing}
              save={patchRow}
              regenerate={resendInvite}
              toggle={toggleStatus}
              remove={deleteRow}
              isSelf={u.email.toLowerCase() === meEmail.toLowerCase()}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`border-b px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase ${className}`}
      style={{ borderColor: "var(--border)" }}
    >
      {children}
    </th>
  );
}

function DraftRow({
  draft,
  setDraft,
  cancel,
  submit,
}: {
  draft: { email: string; displayName: string; role: RoleKey };
  setDraft: (d: { email: string; displayName: string; role: RoleKey }) => void;
  cancel: () => void;
  submit: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      cancel();
    }
  };
  return (
    <tr
      style={{
        backgroundColor:
          "color-mix(in srgb, " + BRAND_GREEN + " 4%, var(--surface))",
      }}
    >
      <Td>
        <input
          ref={nameRef}
          type="text"
          placeholder="Full name"
          value={draft.displayName}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          onKeyDown={onKey}
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
      </Td>
      <Td>
        <input
          type="email"
          placeholder="email@company.com"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          onKeyDown={onKey}
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
      </Td>
      <Td>
        <select
          value={draft.role}
          onChange={(e) =>
            setDraft({ ...draft, role: e.target.value as RoleKey })
          }
          onKeyDown={onKey}
          className="w-full text-sm outline-none"
          // Explicit dark surface so the native options popup matches the
          // rest of the admin UI; bg-transparent let the OS pick a default
          // (usually white) on Chrome/Linux.
          style={{
            color: "var(--text)",
            backgroundColor: "var(--surface)",
          }}
        >
          {CREATABLE_ROLES.map((r) => (
            <option
              key={r.value}
              value={r.value}
              style={{ backgroundColor: "var(--surface)", color: "var(--text)" }}
            >
              {r.label}
            </option>
          ))}
        </select>
      </Td>
      <Td>
        <span
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          (will be active)
        </span>
      </Td>
      <Td className="text-right">
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={submit}
            className="rounded-md px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded-md px-2.5 py-1 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
        </div>
      </Td>
    </tr>
  );
}

function BodyRow({
  row,
  editing,
  setEditing,
  save,
  regenerate,
  toggle,
  remove,
  isSelf,
}: {
  row: UserRow;
  editing: { id: string; field: "displayName" | "role" } | null;
  setEditing: (e: { id: string; field: "displayName" | "role" } | null) => void;
  save: (id: string, patch: Partial<UserRow>) => Promise<void>;
  regenerate: (row: UserRow) => void;
  toggle:     (row: UserRow) => void;
  remove:     (row: UserRow) => void;
  isSelf: boolean;
}) {
  const editingName = editing?.id === row.id && editing.field === "displayName";
  const editingRole = editing?.id === row.id && editing.field === "role";

  return (
    <tr
      className="transition-colors"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <Td onClick={() => !isSelf && setEditing({ id: row.id, field: "displayName" })}>
        {editingName ? (
          <CellInput
            initial={row.displayName}
            onCommit={async (v) => {
              setEditing(null);
              if (v !== row.displayName) await save(row.id, { displayName: v });
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span style={{ color: "var(--text)" }}>{row.displayName || "—"}</span>
        )}
      </Td>
      <Td>
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {row.email}
        </span>
      </Td>
      <Td
        onClick={() =>
          !isSelf &&
          row.primaryRole !== "super_admin" &&
          setEditing({ id: row.id, field: "role" })
        }
      >
        {editingRole ? (
          <CellSelect
            initial={(row.primaryRole as RoleKey) ?? "engineer"}
            options={CREATABLE_ROLES}
            onCommit={async (v) => {
              setEditing(null);
              if (v !== row.primaryRole) await save(row.id, { primaryRole: v });
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <RoleChip role={row.primaryRole ?? row.roles[0] ?? "—"} />
        )}
      </Td>
      <Td>
        <StatusChip status={row.status} awaitingFirstSignIn={row.awaitingFirstSignIn} />
      </Td>
      <Td className="text-right">
        {isSelf ? (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            (you)
          </span>
        ) : (
          <div className="inline-flex items-center gap-1">
            <IconAction
              onClick={() => regenerate(row)}
              title="Resend invitation email"
              icon={<Mail size={14} />}
            />
            <IconAction
              onClick={() => toggle(row)}
              title={row.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
              icon={<Power size={14} />}
            />
            <IconAction
              onClick={() => remove(row)}
              title="Delete"
              icon={<Trash2 size={14} />}
              danger
            />
          </div>
        )}
      </Td>
    </tr>
  );
}

function Td({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <td
      onClick={onClick}
      className={`px-3 py-2 align-middle ${onClick ? "cursor-text" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

function CellInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value.trim());
        else if (e.key === "Escape") onCancel();
      }}
      className="w-full bg-transparent text-sm outline-none"
      style={{
        color: "var(--text)",
        borderBottom: `1px dashed ${BRAND_GREEN}`,
      }}
    />
  );
}

function CellSelect({
  initial,
  options,
  onCommit,
  onCancel,
}: {
  initial: RoleKey;
  options: { value: RoleKey; label: string }[];
  onCommit: (v: RoleKey) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<RoleKey>(initial);
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value as RoleKey)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      className="w-full text-sm outline-none"
      style={{
        color: "var(--text)",
        backgroundColor: "var(--surface)",
      }}
    >
      {options.map((o) => (
        <option
          key={o.value}
          value={o.value}
          style={{ backgroundColor: "var(--surface)", color: "var(--text)" }}
        >
          {o.label}
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
        backgroundColor:
          "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      {formatRole(role)}
    </span>
  );
}

function StatusChip({
  status,
  awaitingFirstSignIn,
}: {
  status: "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn: boolean;
}) {
  if (status === "DEACTIVATED") {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--text-muted) 14%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        Deactivated
      </span>
    );
  }
  if (awaitingFirstSignIn) {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--accent-red) 10%, transparent)",
          color: "var(--accent-red)",
        }}
      >
        Awaiting first sign-in
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor:
          "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      Active
    </span>
  );
}

function IconAction({
  onClick,
  title,
  icon,
  danger,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded-md p-1.5 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
      style={{ color: danger ? "var(--accent-red)" : "var(--text-muted)" }}
    >
      {icon}
    </button>
  );
}

