"use client";

/*
 * Settings building blocks shared by the Enterprise / Department / Channel
 * Partner settings screens. Sectioned cards, editable fields with inline
 * save, toggles, copy rows, and an avatar/initials block — modeled on the
 * quality of the engineer/customer settings, token-themed.
 */

import { useState, type ReactNode } from "react";
import { Check, Copy, Pencil } from "lucide-react";

export function SettingsSection({
  icon, title, desc, children, accent,
}: {
  icon?: ReactNode; title: string; desc?: string; children: ReactNode; accent?: boolean;
}) {
  return (
    <section
      className="rounded-2xl border p-5"
      style={{
        borderColor: accent ? "var(--primary)" : "var(--border)",
        background: accent ? "var(--primary-tint)" : "var(--surface)",
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        {icon ? <span style={{ color: accent ? "var(--primary-hover)" : "var(--text-muted)" }}>{icon}</span> : null}
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
      </div>
      {desc ? <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>{desc}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

/** Inline-editable text field with Save/Cancel. onSave returns a promise. */
export function EditableField({
  label, value, onSave, mono, placeholder, readOnly, hint,
}: {
  label: string; value: string;
  onSave?: (next: string) => Promise<void> | void;
  mono?: boolean; placeholder?: string; readOnly?: boolean; hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!onSave) return;
    setBusy(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-1.5 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
        {editing ? (
          <input
            autoFocus
            value={draft}
            disabled={busy}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            className="mt-1 h-9 w-full rounded-lg border px-3 text-sm sm:w-72"
            style={{ borderColor: "var(--border-strong)", background: "var(--background)", color: "var(--text)" }}
          />
        ) : (
          <div className={mono ? "font-mono text-sm" : "text-sm"} style={{ color: "var(--text)" }}>{value || "—"}</div>
        )}
        {hint ? <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>{hint}</div> : null}
      </div>
      {!readOnly && onSave ? (
        editing ? (
          <div className="flex shrink-0 gap-1.5">
            <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white" style={{ background: "var(--primary)" }}>
              <Check size={13} /> Save
            </button>
            <button type="button" onClick={() => { setDraft(value); setEditing(false); }} className="rounded-md border px-2.5 py-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setDraft(value); setEditing(true); }} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            <Pencil size={12} /> Edit
          </button>
        )
      ) : null}
    </div>
  );
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between border-t py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
      <div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
        <div className="font-mono text-sm" style={{ color: "var(--text)" }}>{value || "—"}</div>
      </div>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function SettingsToggle({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between border-t py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 pr-3">
        <div className="text-sm" style={{ color: "var(--text)" }}>{label}</div>
        {desc ? <div className="text-xs" style={{ color: "var(--text-muted)" }}>{desc}</div> : null}
      </div>
      <button
        type="button" role="switch" aria-checked={on} aria-label={label}
        onClick={() => onChange(!on)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: on ? "var(--primary)" : "var(--surface-raised)" }}
      >
        <span className="absolute top-0.5 size-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
      </button>
    </div>
  );
}

/** Initials/logo block for org/partner identity. */
export function IdentityBlock({ name, sub }: { name: string; sub?: string }) {
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl font-serif text-xl font-semibold" style={{ background: "var(--primary-tint)", color: "var(--primary-hover)" }}>
        {initials}
      </span>
      <div>
        <div className="font-serif text-lg" style={{ color: "var(--text)" }}>{name || "—"}</div>
        {sub ? <div className="text-xs" style={{ color: "var(--text-muted)" }}>{sub}</div> : null}
      </div>
    </div>
  );
}
