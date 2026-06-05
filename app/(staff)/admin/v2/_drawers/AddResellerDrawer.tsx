"use client";

/*
 * Add-reseller drawer. POSTs to /api/admin/resellers, which creates the
 * reseller row + invites the owner + transfers the initial minutes pool.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function AddResellerDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (resellerId: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [commission, setComm] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setComm("");
    setMinutes("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/resellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          commission: commission.trim() ? Number(commission) : 0,
          allocatedMinutes: minutes.trim() ? Number(minutes) : 0,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        reseller?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.reseller) {
        setError(body.error ?? "Couldn't create channel partner.");
        return;
      }
      onCreated(body.reseller.id);
      reset();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't create channel partner."
      );
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
      title="Add Channel Partner"
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
            {loading ? "Creating…" : "Create"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Channel partner name">
          <Input
            value={name}
            onChange={setName}
            placeholder="Acme Channel Partners LLC"
          />
        </Field>
        <Field label="Owner email">
          <Input
            value={email}
            onChange={setEmail}
            placeholder="owner@acme-partners.com"
            type="email"
          />
        </Field>
        <Field label="Commission (%)">
          <Input
            value={commission}
            onChange={setComm}
            placeholder="10"
            inputMode="numeric"
          />
        </Field>
        <Field label="Initial minutes pool">
          <Input
            value={minutes}
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
