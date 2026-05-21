"use client";

/*
 * Add-department drawer. POSTs to /api/admin/orgs/:orgId/departments
 * (the new admin-side endpoint). Admin fields are optional — pass them
 * to invite the first department_admin alongside; omit to create an
 * empty department.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function AddDepartmentDrawer({
  open,
  orgId,
  onClose,
  onCreated,
}: {
  open:      boolean;
  orgId:    string | null;
  onClose:   () => void;
  onCreated: (deptId: string) => void;
}) {
  const [name, setName]                  = useState("");
  const [adminEmail, setEmail]           = useState("");
  const [adminDisplayName, setDisp]      = useState("");
  const [allocatedMinutes, setMinutes]   = useState("");
  const [error, setError]                = useState<string | null>(null);
  const [loading, setLoading]            = useState(false);

  const reset = () => {
    setName(""); setEmail(""); setDisp(""); setMinutes(""); setError(null);
  };

  const submit = async () => {
    if (!orgId) { setError("Pick an enterprise first."); return; }
    if (!name.trim()) { setError("Department name is required."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/departments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             name.trim(),
          adminEmail:       adminEmail.trim() || undefined,
          adminDisplayName: adminDisplayName.trim() || undefined,
          allocatedMinutes: allocatedMinutes.trim() ? Number(allocatedMinutes) : 0,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { department?: { id: string }; error?: string };
      if (!res.ok || !body.department) {
        setError(body.error ?? "Couldn't create department.");
        return;
      }
      onCreated(body.department.id);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create department.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add Department"
      footer={
        <>
          <SecondaryBtn onClick={() => { reset(); onClose(); }} disabled={loading}>Cancel</SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Creating…" : "Create"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Department name">
          <Input value={name} onChange={setName} placeholder="Engineering" />
        </Field>
        <Field label="Department admin email (optional)">
          <Input value={adminEmail} onChange={setEmail} placeholder="lead@acme.com" type="email" />
        </Field>
        <Field label="Department admin name (optional)">
          <Input value={adminDisplayName} onChange={setDisp} placeholder="Chris Wong" />
        </Field>
        <Field label="Initial minutes from the enterprise pool">
          <Input value={allocatedMinutes} onChange={setMinutes} placeholder="0" inputMode="numeric" />
        </Field>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Leave admin fields blank to create an empty department; the org's
          enterprise admin can add a department admin later.
        </p>
        {error && <ErrorBanner message={error} />}
      </div>
    </Drawer>
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
  value, onChange, placeholder, type, inputMode,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; inputMode?: "numeric" | "text";
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type ?? "text"}
      inputMode={inputMode}
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
        borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
        background:  "color-mix(in srgb, var(--primary) 8%, transparent)",
        color:       "var(--primary)",
      }}
    >
      {message}
    </p>
  );
}
