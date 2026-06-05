"use client";

/*
 * First-run setup wizard for a new enterprise admin. Three steps:
 *   1. Welcome — confirm the company.
 *   2. First department (optional) — name + its admin. Reuses the live
 *      /api/enterprise/departments endpoint; admins can add more later.
 *   3. Invite people — single invites via /api/enterprise/users (the same
 *      path the shared InviteFlow uses; bulk CSV lives on the Members tab).
 *
 * Surfaced from the Dashboard when the org has no departments + no members,
 * and re-openable any time. Closing is non-destructive — nothing is required.
 */

import { useState } from "react";
import { Building2, Users, Sparkles, Plus, Check, Mail } from "lucide-react";
import { Button, Input, Modal } from "@/app/_components/ui";

const ROLE_OPTIONS = [
  { value: "client", label: "Member" },
  { value: "enterprise_admin", label: "Enterprise admin" },
];

export function SetupWizard({
  open,
  onClose,
  orgName,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  orgName: string;
  /** Called after a department or member is created so the caller can refetch. */
  onChanged?: () => void;
}) {
  const [step, setStep] = useState(1);

  // Step 2 — first department
  const [deptName, setDeptName] = useState("");
  const [deptAdminName, setDeptAdminName] = useState("");
  const [deptAdminEmail, setDeptAdminEmail] = useState("");
  const [createdDepts, setCreatedDepts] = useState<string[]>([]);

  // Step 3 — invite
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("client");
  const [invited, setInvited] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setStep(1);
    setDeptName("");
    setDeptAdminName("");
    setDeptAdminEmail("");
    setCreatedDepts([]);
    setEmail("");
    setName("");
    setRole("client");
    setInvited([]);
    setErr(null);
    onClose();
  };

  const addDepartment = async () => {
    if (!deptName.trim() || !deptAdminName.trim() || !deptAdminEmail.trim()) {
      setErr("Department name, admin name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enterprise/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: deptName.trim(),
          adminDisplayName: deptAdminName.trim(),
          adminEmail: deptAdminEmail.trim().toLowerCase(),
          allocatedMinutes: 0,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error || "Couldn't create department.");
      setCreatedDepts((d) => [...d, deptName.trim()]);
      setDeptName("");
      setDeptAdminName("");
      setDeptAdminEmail("");
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create department.");
    } finally {
      setBusy(false);
    }
  };

  const inviteMember = async () => {
    if (!email.trim() || !name.trim()) {
      setErr("Name and email are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enterprise/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          displayName: name.trim(),
          role,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error || "Invite failed.");
      setInvited((v) => [...v, email.trim().toLowerCase()]);
      setEmail("");
      setName("");
      setRole("client");
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invite failed.");
    } finally {
      setBusy(false);
    }
  };

  const titles = [
    "Welcome to Relay",
    "Create a department",
    "Invite your team",
  ];
  const descs = [
    `Let's get ${orgName} set up. Three quick steps — you can change everything later.`,
    "Departments hold their own minute budget and members. Add your first one, or skip and do it later.",
    "Invite teammates by email. They'll get a link to set up their account. Add as many as you like.",
  ];

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Step {step} of 3
      </span>
      <div className="flex gap-2">
        {step > 1 && (
          <Button
            variant="ghost"
            onClick={() => {
              setErr(null);
              setStep((s) => s - 1);
            }}
            disabled={busy}
          >
            Back
          </Button>
        )}
        {step < 3 ? (
          <Button
            onClick={() => {
              setErr(null);
              setStep((s) => s + 1);
            }}
            disabled={busy}
          >
            {step === 2 && createdDepts.length === 0 ? "Skip" : "Continue"}
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
      {step === 1 && (
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
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
            <Step icon={<Sparkles size={15} />} label="Welcome" />
            <Step icon={<Building2 size={15} />} label="Departments" />
            <Step icon={<Users size={15} />} label="Invite team" />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          {createdDepts.length > 0 && (
            <div
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: "var(--primary)",
                background: "var(--primary-tint)",
                color: "var(--text)",
              }}
            >
              Created: {createdDepts.join(", ")}
            </div>
          )}
          <Input
            label="Department name"
            value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            placeholder="Engineering"
          />
          <Input
            label="Department admin name"
            value={deptAdminName}
            onChange={(e) => setDeptAdminName(e.target.value)}
            placeholder="Jordan Reed"
          />
          <Input
            label="Department admin email"
            type="email"
            value={deptAdminEmail}
            onChange={(e) => setDeptAdminEmail(e.target.value)}
            placeholder="jordan@company.com"
          />
          {err && (
            <p className="text-xs" style={{ color: "var(--risk)" }}>
              {err}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={() => void addDepartment()}
            loading={busy}
            iconLeft={<Plus size={14} />}
          >
            Add department
          </Button>
        </div>
      )}

      {step === 3 && (
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
          <label
            className="flex flex-col gap-1.5 text-sm"
            style={{ color: "var(--text)" }}
          >
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-11 rounded-lg border px-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--background)",
                color: "var(--text)",
              }}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {err && (
            <p className="text-xs" style={{ color: "var(--risk)" }}>
              {err}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={() => void inviteMember()}
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

function Step({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-xl border p-3"
      style={{ borderColor: "var(--border)" }}
    >
      <span style={{ color: "var(--primary-hover)" }}>{icon}</span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}
