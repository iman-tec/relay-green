"use client";

/*
 * Shared onboarding primitive — used at every hierarchy level (partner →
 * company → department). Single email OR bulk CSV paste/upload. Posts
 * { recipients } to a configurable endpoint; each recipient gets a coded
 * link + branded email recorded in the invites table. Shows per-recipient
 * results with copyable links.
 *
 * Variants:
 *   "members"   — email [+ name, role, department]  → /api/invite
 *   "companies" — admin email [+ name, companyName] → /api/reseller/enterprises
 */

import { useState, type ReactNode } from "react";
import { Upload, Mail, Check, Copy, Users } from "lucide-react";
import { Button, Input, Modal } from "@/app/_components/ui";
import { parseCsvRecipients, type ParsedRecipient } from "@/lib/relay/csv";

type Variant = "members" | "companies";
type Result = { email: string; ok: boolean; error?: string; link?: string };

export function InviteFlow({
  open, onClose, variant = "members", endpoint = "/api/invite",
  title, roles, onSent,
}: {
  open: boolean;
  onClose: () => void;
  variant?: Variant;
  endpoint?: string;
  title?: string;
  /** Role options for the single-invite role select (members variant). */
  roles?: { value: string; label: string }[];
  onSent?: () => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState(roles?.[0]?.value ?? "");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const reset = () => { setResults(null); setEmail(""); setName(""); setCompanyName(""); setCsv(""); setErr(null); setMode("single"); onClose(); };

  const parsed = mode === "bulk" ? parseCsvRecipients(csv) : { recipients: [], errors: [] };

  const send = async () => {
    const recipients: ParsedRecipient[] = mode === "single"
      ? (email.trim() ? [{ email: email.trim().toLowerCase(), name: name.trim() || undefined, companyName: companyName.trim() || undefined, role }] : [])
      : parsed.recipients;
    if (recipients.length === 0) { setErr("Add at least one valid email."); return; }
    setBusy(true); setErr(null);
    try {
      if (variant === "companies") {
        // One company created per recipient (org + admin invite).
        const out: Result[] = [];
        for (const r of recipients) {
          try {
            const res = await fetch(endpoint, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: r.companyName || r.email.split("@")[1]?.split(".")[0] || "Company",
                adminEmail: r.email, adminDisplayName: r.name ?? r.email.split("@")[0], allocatedMinutes: 0,
              }),
            });
            const b = (await res.json().catch(() => ({}))) as { error?: string };
            out.push({ email: r.email, ok: res.ok, error: res.ok ? undefined : (b.error || "failed") });
          } catch (e) { out.push({ email: r.email, ok: false, error: e instanceof Error ? e.message : "failed" }); }
        }
        setResults(out);
      } else {
        const res = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: recipients.map((r) => ({ email: r.email, name: r.name, role: r.role || role || undefined })) }),
        });
        const b = (await res.json().catch(() => ({}))) as { error?: string; results?: Result[] };
        if (!res.ok) throw new Error(b.error || "Invite failed");
        setResults(b.results ?? recipients.map((x) => ({ email: x.email, ok: true })));
      }
      onSent?.();
    } catch (e) { setErr(e instanceof Error ? e.message : "Invite failed"); }
    finally { setBusy(false); }
  };

  const onFile = async (f: File | undefined) => { if (f) setCsv(await f.text()); };

  const heading = title ?? (variant === "companies" ? "Add companies" : "Invite people");
  const sentCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <Modal open={open} onClose={reset} title={results ? "Invites sent" : heading}
      description={results ? `${sentCount} of ${results.length} sent. Share the coded links or let the emails do the work.`
        : "Add a single email or paste / upload a CSV (columns: email, name" + (variant === "companies" ? ", company" : ", department, role") + ")."}
      footer={results
        ? <div className="flex justify-end"><Button onClick={reset}>Done</Button></div>
        : <div className="flex justify-end gap-2"><Button variant="ghost" onClick={reset} disabled={busy}>Cancel</Button><Button onClick={send} loading={busy} iconLeft={<Mail size={14} />}>{mode === "bulk" ? `Send ${parsed.recipients.length || ""} invites` : "Send invite"}</Button></div>}>
      {results ? (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {results.map((r) => (
            <li key={r.email} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
              {r.ok ? <Check size={14} style={{ color: "var(--ok)" }} /> : <span style={{ color: "var(--risk)" }}>✕</span>}
              <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{r.email}</span>
              {r.ok && r.link ? (
                <button type="button" onClick={() => { navigator.clipboard?.writeText(r.link!); setCopied(r.email); setTimeout(() => setCopied(null), 1200); }}
                  className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {copied === r.email ? <Check size={12} /> : <Copy size={12} />} link
                </button>
              ) : !r.ok ? <span className="text-xs" style={{ color: "var(--risk)" }}>{r.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1.5">
            {(["single", "bulk"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className="rounded-full border px-3 py-1.5 text-xs capitalize transition-colors"
                style={{ borderColor: mode === m ? "var(--primary)" : "var(--border)", background: mode === m ? "var(--primary-tint)" : "transparent", color: mode === m ? "var(--primary-hover)" : "var(--text-muted)" }}>
                {m === "single" ? "Single" : "Bulk / CSV"}
              </button>
            ))}
          </div>

          {mode === "single" ? (
            <>
              <Input label={variant === "companies" ? "Admin email" : "Email"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              <Input label={variant === "companies" ? "Admin name" : "Name (optional)"} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Reed" />
              {variant === "companies" && <Input label="Company name (optional)" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc." />}
              {variant === "members" && roles && roles.length > 0 && (
                <label className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--text)" }}>Role
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="h-11 rounded-lg border px-3" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }}>
                    {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                <Upload size={14} /> Upload CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
              </label>
              <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6}
                placeholder={variant === "companies" ? "email,name,company\njordan@acme.com,Jordan Reed,Acme Inc." : "email,name,department,role\nsam@co.com,Sam Lee,Engineering,client"}
                className="rounded-lg border p-3 font-mono text-xs" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <Users size={13} /> {parsed.recipients.length} valid recipient{parsed.recipients.length === 1 ? "" : "s"}
                {parsed.errors.length > 0 ? <span style={{ color: "var(--warn)" }}>· {parsed.errors.length} skipped</span> : null}
              </div>
            </>
          )}
          {err && <p className="text-xs" style={{ color: "var(--risk)" }}>{err}</p>}
        </div>
      )}
    </Modal>
  );
}

/** Tiny re-export so callers can render a trigger consistently if desired. */
export function inviteHint(): ReactNode { return null; }
