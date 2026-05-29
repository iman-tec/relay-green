"use client";

/*
 * Add minutes to a department after creation. POSTs to
 * /api/enterprise/departments/:id/refill which calls transfer_to_department
 * atomically (enterprise pool → dept pool). Fixes the gap where a dept
 * created with 0 minutes could never be topped up.
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function RefillDepartmentDrawer({
  open,
  deptId,
  deptName,
  deptAllocated,
  deptRemaining,
  enterpriseRemaining,
  onClose,
  onRefilled,
}: {
  open:                boolean;
  deptId:              string | null;
  deptName:            string;
  deptAllocated:       number;
  deptRemaining:       number;
  enterpriseRemaining: number;
  onClose:             () => void;
  onRefilled:          () => void;
}) {
  const [amount, setAmount]   = useState("100");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset the form each time the drawer opens.
  useEffect(() => {
    if (open) { setAmount("100"); setError(null); }
  }, [open]);

  const submit = async () => {
    if (!deptId) { setError("Pick a department first."); return; }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError("Amount must be greater than 0."); return; }
    if (n > enterpriseRemaining) {
      setError(`Exceeds the enterprise's remaining minutes (${enterpriseRemaining.toLocaleString()}).`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/enterprise/departments/${deptId}/refill`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ amount: n }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error === "not_owned"
          ? "Department not found in your organisation."
          : (body.error ?? "Refill failed."));
        return;
      }
      onRefilled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refill failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Add minutes — ${deptName}`}
      footer={
        <>
          <SecondaryBtn onClick={onClose} disabled={loading}>Cancel</SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Adding…" : "Add minutes"}
          </PrimaryBtn>
        </>
      }
    >
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Enterprise pool available:{" "}
        <strong style={{ color: "var(--text)" }}>{enterpriseRemaining.toLocaleString()}</strong> minutes.
      </p>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        This department currently has{" "}
        <strong style={{ color: "var(--text)" }}>
          {deptRemaining.toLocaleString()} / {deptAllocated.toLocaleString()}
        </strong>{" "}
        minutes remaining.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium" style={{ color: "var(--text)" }}>Minutes to add</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          autoFocus
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        />
      </label>
      {error && (
        <p
          className="mt-3 rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
            background:  "color-mix(in srgb, var(--primary) 8%, transparent)",
            color:       "var(--primary)",
          }}
        >
          {error}
        </p>
      )}
    </Drawer>
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
