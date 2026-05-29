"use client";

/*
 * Super-admin "Add minutes" drawer. Generic over the target — drives both
 * channel-partner refills (/api/admin/resellers/:id/refill → mints) and
 * enterprise refills (/api/admin/orgs/:id/refill → mints for organic,
 * debits the reseller pool for inorganic).
 *
 * The caller passes a fully-formed `target` (title, endpoint, current pool
 * numbers, and a contextual source note). null = closed.
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export type RefillTarget = {
  title:      string;   // e.g. "Add minutes — Acme Corp"
  endpoint:   string;   // POST target
  allocated:  number;
  remaining:  number;
  /** Contextual line explaining where the minutes come from. */
  sourceNote: string;
};

export function AdminRefillDrawer({
  target,
  onClose,
  onRefilled,
}: {
  target:     RefillTarget | null;
  onClose:    () => void;
  onRefilled: () => void;
}) {
  const [amount, setAmount]   = useState("100");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset the form whenever the drawer opens against a new target.
  useEffect(() => {
    if (target) { setAmount("100"); setError(null); }
  }, [target?.endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError("Amount must be greater than 0."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(target.endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ amount: n }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(body.error ?? "Couldn't add minutes."); return; }
      onRefilled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add minutes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      title={target.title}
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
        Current pool:{" "}
        <strong style={{ color: "var(--text)" }}>
          {target.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </strong>{" "}
        remaining of{" "}
        <strong style={{ color: "var(--text)" }}>
          {target.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </strong>{" "}
        allocated.
      </p>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>{target.sourceNote}</p>
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
