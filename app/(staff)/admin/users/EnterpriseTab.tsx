"use client";

/*
 * Enterprise tab — list of Orgs, each expandable to show its members.
 *
 * - "+ Add organization" creates an Org and its first Enterprise Admin in
 *   one form; the admin's plaintext code is revealed once.
 * - Inside each Org, "+ Add member" creates a customer user (role 'builder')
 *   in that Org; their code is revealed once.
 * - Member-row actions (regenerate, deactivate, delete) reuse the Staff-tab
 *   endpoints since they operate on the same auth users.
 */

import { useEffect, useState } from "react";
import { ChevronRight, Plus, Mail, Power, Trash2, X } from "lucide-react";
import { formatRole } from "@/lib/relay/role-labels";

type Member = {
  id:                  string;
  email:               string;
  displayName:         string;
  roles:               string[];
  primaryRole:         string | null;
  status:              "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn: boolean;
};

type Org = {
  id:            string;
  name:          string;
  primaryDomain: string | null;
  status:        string;
  createdAt:     string;
  members:       Member[];
};

const BRAND_GREEN = "#3f5c2e";

export function EnterpriseTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ label: string; action: "invited" | "resent" } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingOrg, setAddingOrg] = useState(false);
  const [memberDraftOrgId, setMemberDraftOrgId] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load orgs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const toggleExpanded = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const createOrg = async (input: {
    name: string;
    primaryDomain: string;
    adminEmail: string;
    adminDisplayName: string;
  }) => {
    setError(null);
    const res = await fetch("/api/admin/orgs", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as {
      org?: Org;
      invited?: boolean;
      error?: string;
    };
    if (!res.ok) {
      setError(body.error ?? "Couldn't create org.");
      return;
    }
    setReveal({ label: `${input.adminEmail} (admin of ${input.name})`, action: "invited" });
    setAddingOrg(false);
    await load();
  };

  const addMember = async (
    orgId: string,
    input: { email: string; displayName: string; role: "admin" | "builder" },
  ) => {
    setError(null);
    const res = await fetch(`/api/admin/orgs/${orgId}/members`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as {
      invited?: boolean;
      error?: string;
    };
    if (!res.ok) {
      setError(body.error ?? "Couldn't add member.");
      return;
    }
    setReveal({ label: input.email, action: "invited" });
    setMemberDraftOrgId(null);
    await load();
  };

  const regenerate = async (m: Member) => {
    if (!confirm(`Re-send sign-in email to ${m.email}?`)) return;
    const res = await fetch(`/api/admin/users/${m.id}/resend-invite`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { resent?: boolean; error?: string };
    if (!res.ok) { setError(body.error ?? "Resend failed."); return; }
    setReveal({ label: m.email, action: "resent" });
    await load();
  };

  const toggleStatus = async (m: Member) => {
    const next = m.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    const res = await fetch(`/api/admin/users/${m.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(body.error ?? "Update failed."); return; }
    await load();
  };

  const removeMember = async (m: Member) => {
    if (!confirm(`Permanently delete ${m.email}?`)) return;
    const res = await fetch(`/api/admin/users/${m.id}`, { method: "DELETE" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(body.error ?? "Delete failed."); return; }
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      {reveal && <Reveal reveal={reveal} dismiss={() => setReveal(null)} />}
      {error && <ErrorLine message={error} dismiss={() => setError(null)} />}

      <div
        className="overflow-hidden rounded-lg border"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      >
        <div
          className="flex items-center justify-between border-b px-3 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {orgs.length} organization{orgs.length === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={() => setAddingOrg(true)}
            disabled={addingOrg}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            <Plus size={12} /> Add organization
          </button>
        </div>

        {addingOrg && (
          <OrgDraftRow
            cancel={() => setAddingOrg(false)}
            submit={createOrg}
          />
        )}

        {loading && !orgs.length && (
          <p
            className="px-3 py-8 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            Loading…
          </p>
        )}

        {!loading && !orgs.length && !addingOrg && (
          <p
            className="px-3 py-8 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            No organizations yet. Click <strong>Add organization</strong> to create one.
          </p>
        )}

        {orgs.map((org) => (
          <OrgRow
            key={org.id}
            org={org}
            expanded={expanded.has(org.id)}
            toggleExpanded={() => toggleExpanded(org.id)}
            memberDrafting={memberDraftOrgId === org.id}
            startMemberDraft={() => {
              setMemberDraftOrgId(org.id);
              setExpanded(new Set([...expanded, org.id]));
            }}
            cancelMemberDraft={() => setMemberDraftOrgId(null)}
            addMember={(input) => addMember(org.id, input)}
            regenerate={regenerate}
            toggleStatus={toggleStatus}
            remove={removeMember}
          />
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function OrgRow({
  org,
  expanded,
  toggleExpanded,
  memberDrafting,
  startMemberDraft,
  cancelMemberDraft,
  addMember,
  regenerate,
  toggleStatus,
  remove,
}: {
  org: Org;
  expanded: boolean;
  toggleExpanded: () => void;
  memberDrafting: boolean;
  startMemberDraft: () => void;
  cancelMemberDraft: () => void;
  addMember: (input: { email: string; displayName: string; role: "admin" | "builder" }) => Promise<void>;
  regenerate: (m: Member) => void;
  toggleStatus: (m: Member) => void;
  remove: (m: Member) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      >
        <span
          className="transition-transform"
          style={{
            transform: expanded ? "rotate(90deg)" : "none",
            color: "var(--text-muted)",
          }}
        >
          <ChevronRight size={16} />
        </span>
        <div className="flex flex-1 items-baseline gap-3">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            {org.name}
          </span>
          {org.primaryDomain && (
            <span
              className="text-xs"
              style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
            >
              {org.primaryDomain}
            </span>
          )}
        </div>
        <span
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {org.members.length} member{org.members.length === 1 ? "" : "s"}
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-3 py-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--text) 1.5%, var(--surface))",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold tracking-[0.06em] uppercase" style={{ color: "var(--text-muted)" }}>
              Members
            </p>
            <button
              type="button"
              onClick={startMemberDraft}
              disabled={memberDrafting}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-50"
              style={{
                borderColor: BRAND_GREEN,
                color: BRAND_GREEN,
                backgroundColor: "transparent",
              }}
            >
              <Plus size={11} /> Add member
            </button>
          </div>

          {memberDrafting && (
            <MemberDraft
              cancel={cancelMemberDraft}
              submit={addMember}
            />
          )}

          {!org.members.length && !memberDrafting && (
            <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No members yet.
            </p>
          )}

          <table className="w-full border-collapse text-sm">
            <tbody>
              {org.members.map((m) => (
                <tr
                  key={m.id}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td className="px-2 py-1.5" style={{ color: "var(--text)" }}>
                    {m.displayName || "—"}
                  </td>
                  <td
                    className="px-2 py-1.5"
                    style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                  >
                    {m.email}
                  </td>
                  <td className="px-2 py-1.5">
                    <RoleChipInline role={m.primaryRole ?? m.roles[0] ?? "—"} />
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusChipInline status={m.status} awaitingFirstSignIn={m.awaitingFirstSignIn} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <IconBtn onClick={() => regenerate(m)}    title="Resend invitation email" icon={<Mail size={12} />} />
                      <IconBtn onClick={() => toggleStatus(m)}  title={m.status === "ACTIVE" ? "Deactivate" : "Reactivate"} icon={<Power size={12} />} />
                      <IconBtn onClick={() => remove(m)}        title="Delete" icon={<Trash2 size={12} />} danger />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function OrgDraftRow({
  cancel,
  submit,
}: {
  cancel: () => void;
  submit: (input: {
    name: string;
    primaryDomain: string;
    adminEmail: string;
    adminDisplayName: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [primaryDomain, setPrimaryDomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");

  return (
    <div
      className="grid grid-cols-2 gap-3 border-b p-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 4%, var(--surface))",
      }}
    >
      <Field label="Organization name" value={name} onChange={setName} placeholder="Acme Inc" autoFocus />
      <Field label="Primary domain (optional)" value={primaryDomain} onChange={setPrimaryDomain} placeholder="acme.com" />
      <Field label="First admin — name" value={adminDisplayName} onChange={setAdminDisplayName} placeholder="Jane Doe" />
      <Field label="First admin — email" value={adminEmail} onChange={setAdminEmail} placeholder="jane@acme.com" type="email" />
      <div className="col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-3 py-1.5 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (!name.trim() || !adminEmail.trim() || !adminDisplayName.trim()) return;
            void submit({
              name:             name.trim(),
              primaryDomain:    primaryDomain.trim(),
              adminEmail:       adminEmail.trim(),
              adminDisplayName: adminDisplayName.trim(),
            });
          }}
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          Create org + admin
        </button>
      </div>
    </div>
  );
}

function MemberDraft({
  cancel,
  submit,
}: {
  cancel: () => void;
  submit: (input: { email: string; displayName: string; role: "admin" | "builder" }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "builder">("builder");
  return (
    <div
      className="mb-2 grid grid-cols-3 gap-2 rounded-md border p-2"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 4%, var(--surface))",
      }}
    >
      <Field label="Name" value={displayName} onChange={setDisplayName} placeholder="Full name" autoFocus />
      <Field label="Email" value={email} onChange={setEmail} placeholder="user@company.com" type="email" />
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          Role
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "builder")}
          className="rounded-md border px-2.5 py-1.5 text-sm outline-none"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            color: "var(--text)",
          }}
        >
          <option value="builder">Customer</option>
          <option value="admin">Enterprise Admin</option>
        </select>
      </div>
      <div className="col-span-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-3 py-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (!email.trim() || !displayName.trim()) return;
            void submit({ email: email.trim(), displayName: displayName.trim(), role });
          }}
          className="rounded-md px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          Invite
        </button>
      </div>
    </div>
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
      <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
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
          backgroundColor: "var(--surface)",
          color: "var(--text)",
        }}
      />
    </div>
  );
}

function RoleChipInline({ role }: { role: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
        color: BRAND_GREEN,
      }}
    >
      {formatRole(role)}
    </span>
  );
}

function StatusChipInline({
  status,
  awaitingFirstSignIn,
}: {
  status: "ACTIVE" | "DEACTIVATED";
  awaitingFirstSignIn: boolean;
}) {
  if (status === "DEACTIVATED") {
    return (
      <span
        className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        Off
      </span>
    );
  }
  if (awaitingFirstSignIn) {
    return (
      <span
        className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
          color: "var(--accent-red)",
        }}
      >
        Pending
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)",
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
      className="rounded-md p-1 transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
      style={{ color: danger ? "var(--accent-red)" : "var(--text-muted)" }}
    >
      {icon}
    </button>
  );
}

function Reveal({
  reveal,
  dismiss,
}: {
  reveal: { label: string; action: "invited" | "resent" };
  dismiss: () => void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border p-3"
      style={{
        borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 35%, transparent)",
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 6%, transparent)",
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
          <Mail size={14} style={{ color: BRAND_GREEN }} />
          <span>
            {reveal.action === "invited" ? "Invitation sent" : "New sign-in link sent"} to{" "}
            <strong>{reveal.label}</strong>. They&apos;ll click the magic link to sign in.
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
