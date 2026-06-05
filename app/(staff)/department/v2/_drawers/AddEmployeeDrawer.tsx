"use client";

/*
 * Dept-scoped Add Employee drawer. POSTs to /api/department/employees —
 * existing endpoint already linked to the caller's dept via
 * requireDepartmentAdmin.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";
import { BRAND_GREEN } from "@/app/(staff)/enterprise/v2/_kit";

export function AddEmployeeDrawer({
  open,
  deptRemainingMinutes,
  onClose,
  onCreated,
}: {
  open:                  boolean;
  deptRemainingMinutes?: number;
  onClose:               () => void;
  onCreated:             (empId: string) => void;
}) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => { setName(""); setEmail(""); setMinutes(""); setError(null); };

  const submit = async () => {
    if (!name.trim() || !email.trim()) { setError("Name and email are required."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/department/employees", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             name.trim(),
          email:            email.trim(),
          allocatedMinutes: minutes.trim() ? Number(minutes) : 0,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        employee?: { id: string }; error?: string;
      };
      if (!res.ok || !body.employee) {
        setError(body.error ?? "Couldn't add employee.");
        return;
      }
      onCreated(body.employee.id);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add employee.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add Employee"
      footer={
        <>
          <SecondaryBtn onClick={() => { reset(); onClose(); }} disabled={loading}>Cancel</SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Inviting…" : "Invite"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Employee name">
          <Input value={name} onChange={setName} placeholder="Jordan Patel" />
        </Field>
        <Field label="Employee email">
          <Input value={email} onChange={setEmail} placeholder="jordan@acme.com" type="email" />
        </Field>
        <Field label="Initial minutes from the dept pool">
          <Input value={minutes} onChange={setMinutes} placeholder="0" inputMode="numeric" />
          {typeof deptRemainingMinutes === "number" && (
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Available in this department: {deptRemainingMinutes.toLocaleString()} min
            </span>
          )}
        </Field>
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
      className="rounded-md px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
      style={{ background: BRAND_GREEN, color: "#fff" }}
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
