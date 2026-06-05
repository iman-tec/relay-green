"use client";

/*
 * Generic single-field rename drawer. Hits the supplied endpoint with
 * { name: newName } via PATCH. Used by Enterprise / Department /
 * Reseller / Pod / Employee renames — anywhere where the only
 * editable field is the display name and the backend already accepts
 * { name } in a PATCH body.
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function EditNameDrawer({
  open,
  title,
  label,
  currentName,
  endpoint,
  onClose,
  onSaved,
}: {
  open: boolean;
  title: string;
  label: string;
  currentName: string;
  endpoint: string;
  onClose: () => void;
  onSaved: (next: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-sync when a different row's drawer opens.
  useEffect(() => {
    if (open) {
      setName(currentName);
      setError(null);
    }
  }, [open, currentName]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (trimmed === currentName) {
      onClose();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Couldn't save.");
        return;
      }
      onSaved(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <SecondaryBtn onClick={onClose} disabled={loading}>
            Cancel
          </SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span
            className="text-xs font-medium"
            style={{ color: "var(--text)" }}
          >
            {label}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          />
        </label>
        {error && (
          <p
            className="rounded-md border px-3 py-2 text-xs"
            style={{
              borderColor:
                "color-mix(in srgb, var(--primary) 30%, transparent)",
              background: "color-mix(in srgb, var(--primary) 8%, transparent)",
              color: "var(--primary)",
            }}
          >
            {error}
          </p>
        )}
      </div>
    </Drawer>
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
