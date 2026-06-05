"use client";

/*
 * Super-admin: add an enterprise admin to an org. Promote an existing org
 * member, or invite a brand-new admin by email. POSTs to
 * /api/admin/orgs/:orgId/admins. An enterprise can have multiple admins, so
 * this is always available (not an empty-slot-only action).
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/app/_components/admin-v2/Drawer";

type Candidate = { id: string; displayName: string; email: string };

export function AssignEnterpriseAdminDrawer({
  open,
  orgId,
  candidates,
  onClose,
  onAssigned,
}: {
  open: boolean;
  orgId: string | null;
  candidates: Candidate[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const hasCandidates = candidates.length > 0;
  const [mode, setMode] = useState<"promote" | "invite">(
    hasCandidates ? "promote" : "invite"
  );
  const [promoteId, setPromoteId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(hasCandidates ? "promote" : "invite");
    setPromoteId(hasCandidates ? candidates[0].id : "");
    setName("");
    setEmail("");
    setError(null);
  }, [open, hasCandidates, candidates]);

  const reset = () => {
    setName("");
    setEmail("");
    setPromoteId("");
    setError(null);
  };

  const submit = async () => {
    if (!orgId) {
      setError("Pick an enterprise first.");
      return;
    }
    let payload: Record<string, string>;
    if (mode === "promote") {
      if (!promoteId) {
        setError("Choose a member to promote.");
        return;
      }
      payload = { promoteUserId: promoteId };
    } else {
      if (!name.trim() || !email.trim()) {
        setError("Name and email are required.");
        return;
      }
      payload = { email: email.trim(), displayName: name.trim() };
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(humanise(body.error));
        return;
      }
      onAssigned();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add admin.");
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
      title="Add enterprise admin"
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
            {loading ? "Adding…" : mode === "promote" ? "Promote" : "Invite"}
          </PrimaryBtn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5">
          <ModeChip
            active={mode === "promote"}
            disabled={!hasCandidates}
            onClick={() => setMode("promote")}
          >
            Promote member
          </ModeChip>
          <ModeChip
            active={mode === "invite"}
            onClick={() => setMode("invite")}
          >
            Invite by email
          </ModeChip>
        </div>

        {mode === "promote" ? (
          hasCandidates ? (
            <Field label="Member to promote">
              <select
                value={promoteId}
                onChange={(e) => setPromoteId(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || c.email}
                    {c.email && c.displayName ? ` · ${c.email}` : ""}
                  </option>
                ))}
              </select>
              <span
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                They gain enterprise-admin rights for this enterprise.
              </span>
            </Field>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No promotable members in this enterprise yet — invite an admin by
              email instead.
            </p>
          )
        ) : (
          <>
            <Field label="Admin name">
              <Input
                value={name}
                onChange={setName}
                placeholder="Jordan Reed"
              />
            </Field>
            <Field label="Admin email">
              <Input
                value={email}
                onChange={setEmail}
                placeholder="admin@acme.com"
                type="email"
              />
            </Field>
          </>
        )}

        {error && <ErrorBanner message={error} />}
      </div>
    </Drawer>
  );
}

function humanise(code: string | undefined): string {
  switch (code) {
    case "not_in_org":
      return "That member isn't in this enterprise.";
    case "invalid_email":
      return "That doesn't look like a valid email.";
    case "need_promote_or_invite":
      return "Choose a member to promote or enter an email to invite.";
    // Cross-org block returns a full human sentence already; pass it through.
    default:
      return code ?? "Couldn't add admin.";
  }
}

function ModeChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: active ? "var(--primary)" : "var(--border)",
        background: active
          ? "color-mix(in srgb, var(--primary) 12%, transparent)"
          : "transparent",
        color: active ? "var(--primary)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
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
