"use client";

/*
 * Add-pod drawer. POSTs to /api/admin/pods which auto-generates a slug
 * from the name and falls back to numeric suffixes on collision.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function AddPodDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (podId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Pod name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        pod?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.pod) {
        setError(body.error ?? "Couldn't create pod.");
        return;
      }
      onCreated(body.pod.id);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create pod.");
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
      title="Add Pod"
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
        <Field label="Pod name">
          <Input value={name} onChange={setName} placeholder="Pod Alpha" />
        </Field>
        <Field label="Description (optional)">
          <Textarea
            value={description}
            onChange={setDescription}
            placeholder="What this pod focuses on…"
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
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
