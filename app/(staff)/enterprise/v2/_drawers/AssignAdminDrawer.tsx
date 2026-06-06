"use client";

/*
 * Assign a department admin to a department that has none. Two paths in
 * one drawer:
 *   - Promote: pick an existing employee of the department.
 *   - Invite:  name + email for a brand-new admin.
 *
 * POSTs to /api/enterprise/departments/:deptId/admin. The server fills the
 * admin slot only when it's empty (409 otherwise).
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

type EmployeeOption = { id: string; displayName: string; email: string };

export function AssignAdminDrawer({
  open,
  deptId,
  employees,
  onClose,
  onAssigned,
}: {
  open:       boolean;
  deptId:     string | null;
  employees:  EmployeeOption[];
  onClose:    () => void;
  onAssigned: () => void;
}) {
  const hasEmployees = employees.length > 0;
  const [mode, setMode]       = useState<"promote" | "invite">(hasEmployees ? "promote" : "invite");
  const [promoteId, setPromoteId] = useState("");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Default the mode sensibly each time the drawer opens: promote if there
  // are employees to promote, otherwise invite.
  useEffect(() => {
    if (!open) return;
    setMode(hasEmployees ? "promote" : "invite");
    setPromoteId(hasEmployees ? employees[0].id : "");
    setName(""); setEmail(""); setError(null);
  }, [open, hasEmployees, employees]);

  const reset = () => { setName(""); setEmail(""); setPromoteId(""); setError(null); };

  const submit = async () => {
    if (!deptId) { setError("Pick a department first."); return; }
    let payload: Record<string, string>;
    if (mode === "promote") {
      if (!promoteId) { setError("Choose an employee to promote."); return; }
      payload = { promoteUserId: promoteId };
    } else {
      if (!name.trim() || !email.trim()) { setError("Name and email are required."); return; }
      payload = { email: email.trim(), displayName: name.trim() };
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/enterprise/departments/${deptId}/admin`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(humanise(body.error)); return; }
      onAssigned();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't assign admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Assign department admin"
      footer={
        <>
          <SecondaryBtn onClick={() => { reset(); onClose(); }} disabled={loading}>Cancel</SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Assigning…" : mode === "promote" ? "Promote" : "Invite"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Mode toggle — promote only offered when the dept has employees. */}
        <div className="flex gap-1.5">
          <ModeChip
            active={mode === "promote"}
            disabled={!hasEmployees}
            onClick={() => setMode("promote")}
          >
            Promote employee
          </ModeChip>
          <ModeChip active={mode === "invite"} onClick={() => setMode("invite")}>
            Invite by email
          </ModeChip>
        </div>

        {mode === "promote" ? (
          hasEmployees ? (
            <Field label="Employee to promote">
              <select
                value={promoteId}
                onChange={(e) => setPromoteId(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName || e.email}{e.email && e.displayName ? ` · ${e.email}` : ""}
                  </option>
                ))}
              </select>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                They keep their place in the department and gain admin rights.
              </span>
            </Field>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No employees in this department yet — invite an admin by email instead.
            </p>
          )
        ) : (
          <>
            <Field label="Admin name">
              <Input value={name} onChange={setName} placeholder="Chris Wong" />
            </Field>
            <Field label="Admin email">
              <Input value={email} onChange={setEmail} placeholder="lead@acme.com" type="email" />
            </Field>
          </>
        )}

        {error && <ErrorBanner message={error} />}
      </div>
    </Drawer>
  );
}

function humanise(code: string | undefined): string {
  switch (code) {
    case "already_has_admin":        return "This department already has an admin. Remove them first.";
    case "dept_not_active":          return "Reactivate the department before assigning an admin.";
    case "not_in_department":        return "That employee isn't in this department.";
    case "user_in_other_department": return "That person already belongs to another department.";
    case "invalid_email":            return "That doesn't look like a valid email.";
    case "need_promote_or_invite":   return "Choose an employee to promote or enter an email to invite.";
    case "not_owned":                return "Department not found in your organisation.";
    default:                         return code ? `Couldn't assign admin (${code}).` : "Couldn't assign admin.";
  }
}

function ModeChip({
  active, disabled, onClick, children,
}: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: active ? "var(--primary)" : "var(--border)",
        background:  active ? "var(--primary-tint)" : "transparent",
        color:       active ? "var(--primary-hover)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{label}</span>
      {children}
    </label>
  );
}

function Input({
  value, onChange, placeholder, type,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type ?? "text"}
      className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    />
  );
}

function PrimaryBtn({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
      style={{ background: "var(--primary)", color: "#fff" }}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="rounded-md border px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      className="rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: "color-mix(in srgb, var(--risk) 30%, transparent)",
        background:  "color-mix(in srgb, var(--risk) 8%, transparent)",
        color:       "var(--risk)",
      }}
    >
      {message}
    </p>
  );
}
