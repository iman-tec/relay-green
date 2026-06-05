"use client";

/*
 * First-run setup wizard for a new department admin. Two steps:
 *   1. Welcome — confirm the department + show its (read-only) minute budget.
 *      The budget is set by the enterprise admin; the dept admin can only
 *      distribute it to employees, not change the pool itself.
 *   2. Invite employees — single invites via /api/department/employees (the
 *      same path the shared InviteFlow uses; bulk CSV lives on the Members tab).
 *
 * Surfaced from the Dashboard when the department has no employees yet.
 */

import { useState } from "react";
import { Sparkles, Users, Gauge, Check, Mail } from "lucide-react";
import { Button, Input, Modal } from "@/app/_components/ui";

export function DeptSetupWizard({
  open,
  onClose,
  deptName,
  allocatedMinutes,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  deptName: string;
  allocatedMinutes: number;
  onChanged?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setStep(1);
    setEmail("");
    setName("");
    setInvited([]);
    setErr(null);
    onClose();
  };

  const invite = async () => {
    if (!email.trim() || !name.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/department/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          allocatedMinutes: 0,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error || "Invite failed.");
      setInvited((v) => [...v, email.trim().toLowerCase()]);
      setEmail("");
      setName("");
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invite failed.");
    } finally {
      setBusy(false);
    }
  };

  const titles = [`Welcome to ${deptName}`, "Invite your team"];
  const descs = [
    "Your department is ready. You manage its members and parcel out its minute budget — two quick steps.",
    "Invite teammates by email. They'll get a link to set up their account. Allocate minutes to them afterwards from the Team members tab.",
  ];

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Step {step} of 2
      </span>
      <div className="flex gap-2">
        {step > 1 && (
          <Button
            variant="ghost"
            onClick={() => {
              setErr(null);
              setStep(1);
            }}
            disabled={busy}
          >
            Back
          </Button>
        )}
        {step < 2 ? (
          <Button
            onClick={() => {
              setErr(null);
              setStep(2);
            }}
          >
            Continue
          </Button>
        ) : (
          <Button onClick={close} iconLeft={<Check size={14} />}>
            Finish
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={titles[step - 1]}
      description={descs[step - 1]}
      footer={footer}
    >
      {step === 1 ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <span
            className="inline-flex size-14 items-center justify-center rounded-2xl"
            style={{
              background: "var(--primary-tint)",
              color: "var(--primary-hover)",
            }}
          >
            <Sparkles size={26} />
          </span>
          <div
            className="w-full rounded-xl border p-4"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="flex items-center justify-center gap-2 text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              <Gauge size={15} /> Department budget (set by your enterprise)
            </div>
            <div
              className="mt-1 font-serif text-3xl tabular-nums"
              style={{ color: "var(--text)" }}
            >
              {num(allocatedMinutes)}
              <span
                className="ml-1 text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                min
              </span>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              You distribute these minutes to employees. To raise the budget,
              ask your enterprise admin.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {invited.length > 0 && (
            <div
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: "var(--primary)",
                background: "var(--primary-tint)",
                color: "var(--text)",
              }}
            >
              Invited: {invited.join(", ")}
            </div>
          )}
          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <Users size={14} /> Add as many as you like.
          </div>
          <Input
            label="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@company.com"
          />
          {err && (
            <p className="text-xs" style={{ color: "var(--risk)" }}>
              {err}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={() => void invite()}
            loading={busy}
            iconLeft={<Mail size={14} />}
          >
            Send invite
          </Button>
        </div>
      )}
    </Modal>
  );
}

function num(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}
