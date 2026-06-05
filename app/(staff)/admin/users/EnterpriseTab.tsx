"use client";

/*
 * Enterprise tab — master-detail layout matching the Pods tab.
 *
 *   left pane   right pane
 *   ──────────  ──────────────────────────────────
 *   • Acme       Acme Inc · acme.com
 *   • Beta Co    ─────────────────────────────────
 *   • …          ADMINS (1)      [+ Add admin]
 *                  Jane Doe  jane@acme.com  ✕
 *                ENGINEERS / CUSTOMERS (3) [+ Add member]
 *                  ...
 *
 * Org-create modal-style row inside the left pane (same pattern as
 * PodList's create-pod inline form). Member adds use a small inline
 * form that pre-fills nothing and posts to
 * /api/admin/orgs/:orgId/members.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Mail,
  Power,
  Trash2,
  X,
  Search,
  CheckCircle2,
  Building2,
  Users,
} from "lucide-react";
import { formatRole } from "@/lib/relay/role-labels";
import { useConfirmDialog } from "@/app/_components/ConfirmDialog";

type Member = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  primaryRole: string | null;
  status: "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn: boolean;
};

type Department = {
  id: string;
  name: string;
  departmentCode: string;
  adminUserId: string | null;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  memberCount: number;
  createdAt: string;
};

type Org = {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: string;
  /** 'organic' = created by super_admin directly. 'inorganic' = minted
   *  by a reseller. Drives the "via reseller" badge in the UI. */
  enterpriseType: "organic" | "inorganic";
  resellerId: string | null;
  resellerName: string | null;
  createdAt: string;
  members: Member[];
  departments: Department[];
};

const BRAND_GREEN = "#3f5c2e";

export function EnterpriseTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), 3000);
    return () => clearTimeout(t);
  }, [info]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orgs", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        orgs?: Org[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Couldn't load orgs.");
        return;
      }
      setOrgs(body.orgs ?? []);
      setSelectedId((curr) => curr ?? body.orgs?.[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load orgs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createOrg = async (input: {
    name: string;
    primaryDomain: string;
    adminEmail: string;
    adminDisplayName: string;
    allocatedMinutes: number;
  }) => {
    const res = await fetch("/api/admin/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as {
      org?: Org;
      error?: string;
    };
    if (!res.ok)
      return {
        ok: false as const,
        error: body.error ?? "Couldn't create org.",
      };
    await load();
    if (body.org?.id) setSelectedId(body.org.id);
    return { ok: true as const };
  };

  const addMember = async (
    orgId: string,
    input: {
      email: string;
      displayName: string;
      role: "enterprise_admin" | "client";
    }
  ) => {
    const res = await fetch(`/api/admin/orgs/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok)
      return {
        ok: false as const,
        error: body.error ?? "Couldn't add member.",
      };
    await load();
    return { ok: true as const };
  };

  const regenerate = async (m: Member) => {
    if (!confirm(`Re-send sign-in email to ${m.email}?`)) return;
    const res = await fetch(`/api/admin/users/${m.id}/resend-invite`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Resend failed.");
      return;
    }
    await load();
  };

  const toggleStatus = async (m: Member) => {
    const next = m.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    const res = await fetch(`/api/admin/users/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Update failed.");
      return;
    }
    await load();
  };

  const removeMember = async (m: Member) => {
    const ok = await confirmDialog.ask({
      title: "Delete member?",
      message: `${m.email} will be permanently removed — auth record, profile, and roles included.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/users/${m.id}`, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Delete failed.");
      return;
    }
    setInfo(`Deleted ${m.email}.`);
    await load();
  };

  const deleteOrg = async (o: Org) => {
    const ok = await confirmDialog.ask({
      title: `Delete "${o.name}"?`,
      message:
        "The organization will be removed and its members detached. Member accounts themselves are kept.",
      confirmLabel: "Delete organization",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/orgs/${o.id}`, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Delete failed.");
      return;
    }
    setInfo(`Organization "${o.name}" deleted.`);
    if (selectedId === o.id) setSelectedId(null);
    await load();
  };

  const selected = orgs.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorLine message={error} dismiss={() => setError(null)} />}
      {info && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium"
          style={{
            backgroundColor:
              "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
            color: BRAND_GREEN,
            borderColor:
              "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
            animation: "relay-toast-in 180ms ease-out",
          }}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 size={14} />
            {info}
          </span>
          <button
            type="button"
            onClick={() => setInfo(null)}
            aria-label="Dismiss"
            className="rounded-md p-1"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-[300px_1fr] gap-4">
        <OrgList
          orgs={orgs}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          createOrg={createOrg}
        />

        <div>
          {!selected ? (
            <EmptyDetail />
          ) : (
            <OrgDetail
              org={selected}
              addMember={(input) => addMember(selected.id, input)}
              regenerate={regenerate}
              toggleStatus={toggleStatus}
              remove={removeMember}
              deleteOrg={() => void deleteOrg(selected)}
            />
          )}
        </div>
      </div>
      {confirmDialog.element}
    </div>
  );
}

/* ──────── Left pane: org list + create ──────── */

function OrgList({
  orgs,
  selectedId,
  onSelect,
  loading,
  createOrg,
}: {
  orgs: Org[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  loading: boolean;
  createOrg: (input: {
    name: string;
    primaryDomain: string;
    adminEmail: string;
    adminDisplayName: string;
    allocatedMinutes: number;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.primaryDomain ?? "").toLowerCase().includes(q)
    );
  }, [orgs, query]);

  return (
    <aside
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Organizations ({orgs.length})
        </h3>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Plus size={11} />
          New
        </button>
      </div>

      {creating && (
        <OrgCreateInline
          submit={async (input) => {
            const r = await createOrg(input);
            if (r.ok) setCreating(false);
            return r;
          }}
          cancel={() => setCreating(false)}
        />
      )}

      {!loading && orgs.length > 0 && (
        <div
          className="relative border-b px-3 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search organizations…"
            className="w-full rounded-md border py-1.5 pr-7 pl-7 text-xs outline-none"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--background)",
              color: "var(--text)",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-5 -translate-y-1/2 rounded-md p-0.5"
              style={{ color: "var(--text-muted)" }}
              title="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2
            size={16}
            className="animate-spin"
            style={{ color: BRAND_GREEN }}
          />
        </div>
      ) : orgs.length === 0 ? (
        <p
          className="px-4 py-10 text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          No organizations yet. Create your first one to start adding admins and
          customers.
        </p>
      ) : filtered.length === 0 ? (
        <p
          className="px-4 py-10 text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          No organizations match “{query}”.
        </p>
      ) : (
        <div className="max-h-[600px] overflow-y-auto">
          {filtered.map((o) => {
            const active = o.id === selectedId;
            const admins = o.members.filter((m) => isAdmin(m)).length;
            const depts = o.departments?.length ?? 0;
            const viaReseller = o.enterpriseType === "inorganic";
            return (
              <button
                key={o.id}
                onClick={() => onSelect(o.id)}
                className="relative block w-full border-b px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: active
                    ? "color-mix(in srgb, var(--text) 4%, transparent)"
                    : "transparent",
                }}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-2 left-0 w-[2px] rounded-r-sm"
                    style={{ backgroundColor: BRAND_GREEN }}
                  />
                )}
                <div className="flex items-center gap-2">
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    {o.name}
                  </span>
                  {viaReseller && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                        color: "var(--text-muted)",
                      }}
                      title={
                        o.resellerName
                          ? `Created via ${o.resellerName}`
                          : "Created via a reseller"
                      }
                    >
                      via reseller
                    </span>
                  )}
                </div>
                <div
                  className="mt-0.5 text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {admins} admin{admins === 1 ? "" : "s"} · {depts} department
                  {depts === 1 ? "" : "s"}
                  {o.primaryDomain && (
                    <>
                      {" "}
                      ·{" "}
                      <span style={{ fontFamily: "var(--font-mono)" }}>
                        {o.primaryDomain}
                      </span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function EmptyDetail() {
  return (
    <div
      className="flex h-[400px] items-center justify-center rounded-xl border"
      style={{ borderColor: "var(--border)" }}
    >
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Select an organization on the left, or create a new one.
      </p>
    </div>
  );
}

function OrgCreateInline({
  submit,
  cancel,
}: {
  submit: (input: {
    name: string;
    primaryDomain: string;
    adminEmail: string;
    adminDisplayName: string;
    allocatedMinutes: number;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  cancel: () => void;
}) {
  const [name, setName] = useState("");
  const [primaryDomain, setPrimaryDomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [allocatedMinutes, setAllocatedMinutes] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!name.trim() || !adminEmail.trim() || !adminDisplayName.trim()) {
      setErr("Org name, admin name and admin email are required.");
      return;
    }
    const alloc = Number(allocatedMinutes);
    if (Number.isNaN(alloc) || alloc < 0) {
      setErr("Minutes allocation must be a non-negative number.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await submit({
      name: name.trim(),
      primaryDomain: primaryDomain.trim(),
      adminEmail: adminEmail.trim(),
      adminDisplayName: adminDisplayName.trim(),
      allocatedMinutes: alloc,
    });
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <div
      className="border-b p-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
      }}
    >
      <div className="grid grid-cols-1 gap-2">
        <Field
          label="Organization name"
          value={name}
          onChange={setName}
          placeholder="Acme Inc"
          autoFocus
        />
        <Field
          label="Primary domain (optional)"
          value={primaryDomain}
          onChange={setPrimaryDomain}
          placeholder="acme.com"
        />
        <Field
          label="First admin — name"
          value={adminDisplayName}
          onChange={setAdminDisplayName}
          placeholder="Jane Doe"
        />
        <Field
          label="First admin — email"
          value={adminEmail}
          onChange={setAdminEmail}
          placeholder="jane@acme.com"
          type="email"
        />
        <Field
          label="Minutes allocation"
          value={allocatedMinutes}
          onChange={setAllocatedMinutes}
          placeholder="0"
          type="number"
        />
      </div>
      {err && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--accent-red)" }}>
          {err}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : null}
          {busy ? "Creating…" : "Create org + admin"}
        </button>
      </div>
    </div>
  );
}

/* ──────── Right pane: org detail ──────── */

function OrgDetail({
  org,
  addMember,
  regenerate,
  toggleStatus,
  remove,
  deleteOrg,
}: {
  org: Org;
  addMember: (input: {
    email: string;
    displayName: string;
    role: "enterprise_admin" | "client";
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  regenerate: (m: Member) => void;
  toggleStatus: (m: Member) => void;
  remove: (m: Member) => void;
  deleteOrg: () => void;
}) {
  const admins = org.members.filter(isAdmin);
  const departments = org.departments ?? [];

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-sm font-semibold"
              style={{ color: "var(--text)" }}
            >
              {org.name}
            </span>
            {org.enterpriseType === "inorganic" && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                  color: "var(--text-muted)",
                }}
                title={
                  org.resellerName
                    ? `Minted by reseller "${org.resellerName}"`
                    : "Minted by a reseller"
                }
              >
                via {org.resellerName ?? "reseller"}
              </span>
            )}
          </div>
          {org.primaryDomain && (
            <div
              className="mt-0.5 text-[11px]"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {org.primaryDomain}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
            style={{
              backgroundColor:
                "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
              color: BRAND_GREEN,
            }}
          >
            {org.status}
          </span>
          <button
            onClick={deleteOrg}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--accent-red)" }}
            title="Delete organization"
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      </div>

      <MemberSection
        title="Admins"
        addLabel="Add admin"
        addRole="enterprise_admin"
        members={admins}
        addMember={addMember}
        regenerate={regenerate}
        toggleStatus={toggleStatus}
        remove={remove}
      />
      <DepartmentSection departments={departments} />
    </div>
  );
}

/* ──────── Departments (read-only — managed by the enterprise admin) ──────── */

function DepartmentSection({ departments }: { departments: Department[] }) {
  return (
    <section className="border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <h3
          className="text-[10px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Departments ({departments.length})
        </h3>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Managed by the enterprise admin
        </span>
      </div>

      {departments.length === 0 ? (
        <p className="px-5 pb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No departments yet. The enterprise admin can create departments from{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>
            /enterprise/departments
          </span>
          .
        </p>
      ) : (
        <ul className="pb-2">
          {departments.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 border-t px-5 py-2.5"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
                  color: BRAND_GREEN,
                }}
              >
                <Building2 size={14} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div
                  className="truncate text-sm"
                  style={{ color: "var(--text)" }}
                >
                  {d.name}
                </div>
                <div
                  className="mt-0.5 truncate text-[11px]"
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {d.departmentCode}
                </div>
              </div>
              <div
                className="inline-flex items-center gap-1 text-[11px]"
                style={{ color: "var(--text-muted)" }}
                title={`${d.memberCount} member${d.memberCount === 1 ? "" : "s"}`}
              >
                <Users size={11} />
                {d.memberCount}
              </div>
              <span
                className="text-[11px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
                title={`Allocated ${d.allocatedMinutes}, used ${d.usedMinutes}, remaining ${d.remainingMinutes}`}
              >
                {Math.round(d.remainingMinutes)} /{" "}
                {Math.round(d.allocatedMinutes)} min
              </span>
              <StatusChipInline
                status={d.status === "active" ? "ACTIVE" : "DEACTIVATED"}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberSection({
  title,
  addLabel,
  addRole,
  members,
  addMember,
  regenerate,
  toggleStatus,
  remove,
}: {
  title: string;
  addLabel: string;
  addRole: "enterprise_admin" | "client";
  members: Member[];
  addMember: (input: {
    email: string;
    displayName: string;
    role: "enterprise_admin" | "client";
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  regenerate: (m: Member) => void;
  toggleStatus: (m: Member) => void;
  remove: (m: Member) => void;
}) {
  const [drafting, setDrafting] = useState(false);

  return (
    <section className="border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <h3
          className="text-[10px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          {title} ({members.length})
        </h3>
        <button
          onClick={() => setDrafting(true)}
          disabled={drafting}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Plus size={10} />
          {addLabel}
        </button>
      </div>

      {drafting && (
        <MemberDraft
          role={addRole}
          cancel={() => setDrafting(false)}
          submit={async (input) => {
            const r = await addMember(input);
            if (r.ok) setDrafting(false);
            return r;
          }}
        />
      )}

      {members.length === 0 && !drafting ? (
        <p className="px-5 pb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No {title.toLowerCase()} yet.
        </p>
      ) : (
        <ul className="pb-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 border-t px-5 py-2.5"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--text-muted) 14%, transparent)",
                  color: "var(--text-muted)",
                }}
              >
                {(m.displayName || m.email || "?")[0]}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div
                  className="truncate text-sm"
                  style={{ color: "var(--text)" }}
                >
                  {m.displayName || m.email}
                </div>
                {m.displayName && m.email && (
                  <div
                    className="truncate text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {m.email}
                  </div>
                )}
              </div>
              <RoleChipInline role={m.primaryRole ?? m.roles[0] ?? "—"} />
              <StatusChipInline
                status={m.status}
                awaitingFirstSignIn={m.awaitingFirstSignIn}
              />
              <div className="inline-flex items-center gap-1">
                <IconBtn
                  onClick={() => regenerate(m)}
                  title="Resend invitation email"
                  icon={<Mail size={12} />}
                />
                <IconBtn
                  onClick={() => toggleStatus(m)}
                  title={m.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                  icon={<Power size={12} />}
                />
                <IconBtn
                  onClick={() => remove(m)}
                  title="Delete"
                  icon={<Trash2 size={12} />}
                  danger
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberDraft({
  role,
  cancel,
  submit,
}: {
  role: "enterprise_admin" | "client";
  cancel: () => void;
  submit: (input: {
    email: string;
    displayName: string;
    role: "enterprise_admin" | "client";
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!email.trim() || !displayName.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await submit({
      email: email.trim(),
      displayName: displayName.trim(),
      role,
    });
    if (!r.ok) setErr(r.error);
    setBusy(false);
  };

  return (
    <div
      className="border-t px-5 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
            if (e.key === "Escape") cancel();
          }}
          placeholder="Full name"
          className="flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--background)",
            color: "var(--text)",
          }}
          disabled={busy}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
            if (e.key === "Escape") cancel();
          }}
          placeholder="email@company.com"
          className="flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--background)",
            color: "var(--text)",
          }}
          disabled={busy}
        />
      </div>
      {err && (
        <p className="mb-2 text-[11px]" style={{ color: "var(--accent-red)" }}>
          {err}
        </p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={cancel}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => void onSubmit()}
          disabled={busy || !email.trim() || !displayName.trim()}
          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {busy ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Plus size={11} />
          )}
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
    </div>
  );
}

/* ──────── Small helpers ──────── */

function isAdmin(m: Member): boolean {
  return (
    m.primaryRole === "enterprise_admin" || m.roles.includes("enterprise_admin")
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[11px] font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="rounded-md border px-2.5 py-1.5 text-sm outline-none"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--background)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}

function RoleChipInline({ role }: { role: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
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

function StatusChipInline({
  status,
}: {
  status: "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn?: boolean;
}) {
  if (status === "DEACTIVATED") {
    return (
      <span
        className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
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
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
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

function IconBtn({
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
      className="rounded-md p-1 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05]"
      style={{ color: danger ? "var(--accent-red)" : "var(--text-muted)" }}
    >
      {icon}
    </button>
  );
}

function ErrorLine({
  message,
  dismiss,
}: {
  message: string;
  dismiss: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--accent-red) 8%, transparent)",
        color: "var(--accent-red)",
        borderColor: "color-mix(in srgb, var(--accent-red) 25%, transparent)",
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
