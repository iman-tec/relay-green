"use client";

/*
 * Add-enterprise drawer for the reseller panel. POSTs to
 * /api/reseller/enterprises which creates an inorganic org under this
 * reseller, invites the first enterprise_admin, and atomically debits the
 * reseller's pool when allocatedMinutes > 0.
 *
 * Shape-matched to the Superadmin drawer (Drawer chrome, Field/Input,
 * footer with Cancel + primary CTA) so the two consoles feel like
 * siblings.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function AddEnterpriseDrawer({
  open,
  onClose,
  onCreated,
  resellerRemaining,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (orgId: string) => void;
  resellerRemaining: number;
}) {
  const [name, setName] = useState("");
  const [primaryDomain, setDomain] = useState("");
  const [adminEmail, setEmail] = useState("");
  const [adminDisplayName, setDisp] = useState("");
  const [allocatedMinutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName("");
    setDomain("");
    setEmail("");
    setDisp("");
    setMinutes("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || !adminEmail.trim() || !adminDisplayName.trim()) {
      setError("Name, admin name, and admin email are required.");
      return;
    }
    const alloc = allocatedMinutes.trim() ? Number(allocatedMinutes) : 0;
    if (!Number.isFinite(alloc) || alloc < 0) {
      setError("Allocation must be ≥ 0.");
      return;
    }
    if (alloc > resellerRemaining) {
      setError(
        `Allocation exceeds your remaining minutes (${resellerRemaining}).`
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reseller/enterprises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          primaryDomain: primaryDomain.trim() || undefined,
          adminEmail: adminEmail.trim(),
          adminDisplayName: adminDisplayName.trim(),
          allocatedMinutes: alloc,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        enterprise?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.enterprise) {
        setError(body.error ?? "Couldn't create enterprise.");
        return;
      }
      onCreated(body.enterprise.id);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create enterprise.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add Enterprise"
      footer={
        <>
          <SecondaryBtn
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={loading}
          >
            Cancel
          </SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Creating…" : "Create + invite admin"}
          </PrimaryBtn>
        </>
      }
    >
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Your remaining pool:{" "}
        <strong style={{ color: "var(--text)" }}>
          {resellerRemaining.toLocaleString()}
        </strong>{" "}
        minutes.
      </p>
      <div className="flex flex-col gap-3">
        <Field label="Enterprise name">
          <Input value={name} onChange={setName} placeholder="Acme Corp" />
        </Field>
        <Field label="Primary domain (optional)">
          <Input
            value={primaryDomain}
            onChange={setDomain}
            placeholder="acme.com"
          />
        </Field>
        <Field label="Enterprise admin email">
          <Input
            value={adminEmail}
            onChange={setEmail}
            placeholder="admin@acme.com"
            type="email"
          />
        </Field>
        <Field label="Enterprise admin name">
          <Input
            value={adminDisplayName}
            onChange={setDisp}
            placeholder="Pat Lee"
          />
        </Field>
        <Field label="Initial minutes allocation">
          <Input
            value={allocatedMinutes}
            onChange={setMinutes}
            placeholder="0"
            inputMode="numeric"
          />
        </Field>
        {error && <ErrorBanner message={error} />}
      </div>
    </Drawer>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "numeric" | "text";
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

function PrimaryBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
      style={{ background: "var(--primary)", color: "#fff" }}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
        background: "color-mix(in srgb, var(--primary) 8%, transparent)",
        color: "var(--primary)",
      }}
    >
      {message}
    </p>
  );
}
