"use client";

/*
 * Add-internal-user drawer. Creates an engineer / supervisor / super
 * admin via the existing /api/admin/users POST — same endpoint the old
 * panel uses, so role grants + invite emails stay consistent.
 */

import { useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";
import { ROLE } from "@/lib/relay/roles";

type RoleKey = typeof ROLE.engineer | typeof ROLE.supervisor | typeof ROLE.super_admin;

const ROLE_OPTIONS: { value: RoleKey; label: string; hint: string }[] = [
  { value: ROLE.engineer,    label: "Engineer",   hint: "Handles live customer calls" },
  { value: ROLE.supervisor,  label: "Supervisor", hint: "Oversees a pod of engineers" },
  { value: ROLE.super_admin, label: "Superadmin", hint: "Platform-wide administration" },
];

export function AddInternalUserDrawer({
  open,
  defaultRole,
  onClose,
  onCreated,
}: {
  open:        boolean;
  /** Pre-selects the role picker — usually whatever tile the user is on. */
  defaultRole?: RoleKey;
  onClose:     () => void;
  onCreated:   (userId: string) => void;
}) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [role, setRole]       = useState<RoleKey>(defaultRole ?? ROLE.engineer);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync the role picker when the parent opens us for a different tile.
  if (open && defaultRole && defaultRole !== role && !loading && !error && !name && !email) {
    // setState in render is safe here because of the guards above; React will
    // bail if the value is unchanged on a re-render.
    setTimeout(() => setRole(defaultRole), 0);
  }

  const reset = () => {
    setName(""); setEmail(""); setError(null);
    setRole(defaultRole ?? ROLE.engineer);
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) { setError("Name and email are required."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:       email.trim(),
          displayName: name.trim(),
          role,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { user?: { id: string }; error?: string };
      if (!res.ok || !body.user) {
        setError(body.error ?? "Couldn't add user.");
        return;
      }
      onCreated(body.user.id);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add user.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add Internal User"
      footer={
        <>
          <SecondaryBtn onClick={() => { reset(); onClose(); }} disabled={loading}>Cancel</SecondaryBtn>
          <PrimaryBtn onClick={submit} disabled={loading}>
            {loading ? "Inviting…" : "Send invite"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Full name">
          <Input value={name} onChange={setName} placeholder="Pat Lee" />
        </Field>
        <Field label="Email">
          <Input value={email} onChange={setEmail} placeholder="pat@relay.green" type="email" />
        </Field>
        <Field label="Role">
          <div className="flex flex-col gap-1.5">
            {ROLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRole(o.value)}
                className="flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: role === o.value ? "var(--primary)" : "var(--border)",
                  background:  role === o.value
                    ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                    : "transparent",
                  color: "var(--text)",
                }}
              >
                <span className="text-sm font-medium">{o.label}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{o.hint}</span>
              </button>
            ))}
          </div>
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
  value, onChange, placeholder, type,
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type ?? "text"}
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
        borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
        background:  "color-mix(in srgb, var(--primary) 8%, transparent)",
        color:       "var(--primary)",
      }}
    >
      {message}
    </p>
  );
}
