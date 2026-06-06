"use client";

/*
 * Refill drawer for a specific employee. POSTs to
 * /api/department/employees/:id/refill, which calls transfer_to_employee
 * atomically — debits dept.remaining_minutes and credits the employee's
 * allocated + remaining.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

export function RefillEmployeeDrawer({
  open,
  empId,
  empName,
  empCurrent,
  deptRemaining,
  onClose,
  onRefilled,
}: {
  open:           boolean;
  empId:          string | null;
  empName?:       string;
  empCurrent?:    { allocated: number; used: number; remaining: number };
  deptRemaining?: number;
  onClose:        () => void;
  onRefilled:     () => void;
}) {
  const [amount, setAmount]   = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => { setAmount(""); setError(null); };

  const submit = async () => {
    if (!empId) { setError("Pick an employee first."); return; }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    if (typeof deptRemaining === "number" && n > deptRemaining) {
      setError(`Amount exceeds the department's remaining ${deptRemaining.toLocaleString()} min.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/department/employees/${empId}/refill`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ amount: n }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Refill failed.");
        return;
      }
      onRefilled();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refill failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={empName ? `Refill ${empName}` : "Refill minutes"}
      footer={
        <>
          <SecondaryBtn onClick={() => { reset(); onClose(); }} disabled={loading}>Cancel</SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Refilling…" : "Refill"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {empCurrent && (
          <section
            className="rounded-md border px-3 py-2.5 text-xs leading-relaxed"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <div className="flex justify-between">
              <span>Allocated</span>
              <span style={{ color: "var(--text)" }}>{empCurrent.allocated.toLocaleString()} min</span>
            </div>
            <div className="flex justify-between">
              <span>Used</span>
              <span style={{ color: "var(--text)" }}>{empCurrent.used.toLocaleString()} min</span>
            </div>
            <div className="flex justify-between">
              <span>Remaining</span>
              <span style={{ color: "var(--text)" }}>{empCurrent.remaining.toLocaleString()} min</span>
            </div>
          </section>
        )}

        <Field label="Amount to add">
          <Input value={amount} onChange={setAmount} placeholder="100" inputMode="numeric" />
          {typeof deptRemaining === "number" && (
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Department pool: {deptRemaining.toLocaleString()} min remaining
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
  value, onChange, placeholder, inputMode,
}: { value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: "numeric" | "text" }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
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
        borderColor: "color-mix(in srgb, var(--risk) 30%, transparent)",
        background:  "color-mix(in srgb, var(--risk) 8%, transparent)",
        color:       "var(--risk)",
      }}
    >
      {message}
    </p>
  );
}
