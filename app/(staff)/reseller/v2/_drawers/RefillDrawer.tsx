"use client";

/*
 * Refill drawer for the reseller panel. POSTs to
 * /api/reseller/enterprises/:id/refill which atomically debits the
 * reseller's pool and credits the enterprise via transfer_to_organization.
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

type Target = {
  id: string; name: string;
  allocatedMinutes: number;
  usedMinutes:      number;
  remainingMinutes: number;
};

export function RefillDrawer({
  target,
  resellerRemaining,
  onClose,
  onRefilled,
}: {
  target:            Target | null;
  resellerRemaining: number;
  onClose:           () => void;
  onRefilled:        () => void;
}) {
  const [amount, setAmount]   = useState("100");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset form whenever the drawer opens against a new target.
  useEffect(() => {
    if (target) {
      setAmount("100");
      setError(null);
    }
  }, [target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError("Amount must be > 0."); return; }
    if (n > resellerRemaining) {
      setError(`Exceeds your remaining minutes (${resellerRemaining}).`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reseller/enterprises/${target.id}/refill`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ amount: n }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Refill failed.");
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
      open={!!target}
      onClose={onClose}
      title={`Refill — ${target.name}`}
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
        Your remaining pool: <strong style={{ color: "var(--text)" }}>{resellerRemaining.toLocaleString()}</strong> minutes.
      </p>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Enterprise currently has{" "}
        <strong style={{ color: "var(--text)" }}>
          {target.remainingMinutes.toLocaleString()} / {target.allocatedMinutes.toLocaleString()}
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
