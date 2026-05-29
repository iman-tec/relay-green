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
 *   "companies" — admin email + name + company + discount + months
 *                                                    → /api/reseller/enterprises
 *                 CSV-only (no "single" mode — the partner has a richer
 *                 "Onboard a company" modal next to this one for single
 *                 onboards). CSV is validated strictly: missing required
 *                 column → top-level error; per-row missing cells / bad
 *                 numbers → per-row errors; Send disabled until clean.
 */

import { useState, type ReactNode } from "react";
import { Upload, Mail, Check, Copy, Users, AlertTriangle } from "lucide-react";
import { Button, Input, Modal } from "@/app/_components/ui";
import {
  parseCsvRecipients,
  parseCompaniesCsvStrict,
  type ParsedRecipient,
  type ParsedCompaniesRecipient,
} from "@/lib/relay/csv";

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
  const bulkOnly = variant === "companies";
  const [mode, setMode] = useState<"single" | "bulk">(bulkOnly ? "bulk" : "single");
  const [email, setEmail] = useState(""); const [name, setName] = useState("");
  const [role, setRole] = useState(roles?.[0]?.value ?? "");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const reset = () => {
    setResults(null); setEmail(""); setName(""); setCsv("");
    setErr(null); setMode(bulkOnly ? "bulk" : "single"); onClose();
  };

  // Parse based on variant: companies uses the strict parser (header-required,
  // 5 required columns, range checks); members uses the lenient parser.
  const memberParsed = (!bulkOnly && mode === "bulk")
    ? parseCsvRecipients(csv)
    : { recipients: [] as ParsedRecipient[], errors: [] as string[] };
  const companyParsed = bulkOnly
    ? parseCompaniesCsvStrict(csv)
    : { recipients: [] as ParsedCompaniesRecipient[], missingColumns: [] as string[], rowErrors: [] as string[], rowWarnings: [] as string[] };

  const canSend = (() => {
    if (bulkOnly) {
      if (csv.trim().length === 0) return false;
      if (companyParsed.missingColumns.length > 0) return false;
      if (companyParsed.rowErrors.length > 0) return false;
      return companyParsed.recipients.length > 0;
    }
    if (mode === "single") return email.trim().length > 0;
    return memberParsed.recipients.length > 0;
  })();

  const sendCount = bulkOnly
    ? companyParsed.recipients.length
    : memberParsed.recipients.length;

  // When every row succeeded, close the modal instead of showing the
  // per-row results screen — the partner already gets the new clients in
  // the table below + a bell notification per success. Failures still
  // surface the results screen so they can see which rows need attention.
  const finalize = (out: Result[]) => {
    onSent?.();
    if (out.length > 0 && out.every((r) => r.ok)) {
      reset();
    } else {
      setResults(out);
    }
  };

  const send = async () => {
    if (variant === "companies") {
      if (!canSend) { setErr("Fix the CSV before sending."); return; }
      setBusy(true); setErr(null);
      try {
        const out: Result[] = [];
        for (const r of companyParsed.recipients) {
          try {
            const res = await fetch(endpoint, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name:             r.companyName,
                adminEmail:       r.email,
                adminDisplayName: r.name,
                allocatedMinutes: 0,
                discountPct:      r.discountPct,
                discountMonths:   r.discountMonths,
              }),
            });
            const b = (await res.json().catch(() => ({}))) as { error?: string };
            out.push({ email: r.email, ok: res.ok, error: res.ok ? undefined : (b.error || "failed") });
          } catch (e) {
            out.push({ email: r.email, ok: false, error: e instanceof Error ? e.message : "failed" });
          }
        }
        finalize(out);
      } finally {
        setBusy(false);
      }
      return;
    }

    // members variant — preserved as-is.
    const recipients: ParsedRecipient[] = mode === "single"
      ? (email.trim() ? [{ email: email.trim().toLowerCase(), name: name.trim() || undefined, role }] : [])
      : memberParsed.recipients;
    if (recipients.length === 0) { setErr("Add at least one valid email."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: recipients.map((r) => ({ email: r.email, name: r.name, role: r.role || role || undefined })) }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string; results?: Result[] };
      if (!res.ok) throw new Error(b.error || "Invite failed");
      finalize(b.results ?? recipients.map((x) => ({ email: x.email, ok: true })));
    } catch (e) { setErr(e instanceof Error ? e.message : "Invite failed"); }
    finally { setBusy(false); }
  };

  const onFile = async (f: File | undefined) => { if (f) setCsv(await f.text()); };

  const heading = title ?? (variant === "companies" ? "Add companies" : "Invite people");
  const sentCount = results?.filter((r) => r.ok).length ?? 0;

  const companyMissingMsg = companyParsed.missingColumns.length > 0
    ? `Please add ${joinNaturally(companyParsed.missingColumns)} ${companyParsed.missingColumns.length === 1 ? "field" : "fields"} and reupload.`
    : null;

  const description = results
    ? `${sentCount} of ${results.length} sent. Share the coded links or let the emails do the work.`
    : (variant === "companies"
        ? "Paste or upload a CSV with these columns: email, name, company, discount, months."
        : "Add a single email or paste / upload a CSV (columns: email, name, department, role).");

  return (
    <Modal open={open} onClose={reset} title={results ? "Invites sent" : heading}
      description={description}
      footer={results
        ? <div className="flex justify-end"><Button onClick={reset}>Done</Button></div>
        : <div className="flex justify-end gap-2"><Button variant="ghost" onClick={reset} disabled={busy}>Cancel</Button><Button onClick={send} loading={busy} disabled={!canSend} iconLeft={<Mail size={14} />}>{(bulkOnly || mode === "bulk") ? `Send ${sendCount || ""} invites` : "Send invite"}</Button></div>}>
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
          {!bulkOnly && (
            <div className="flex gap-1.5">
              {(["single", "bulk"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className="rounded-full border px-3 py-1.5 text-xs capitalize transition-colors"
                  style={{ borderColor: mode === m ? "var(--primary)" : "var(--border)", background: mode === m ? "var(--primary-tint)" : "transparent", color: mode === m ? "var(--primary-hover)" : "var(--text-muted)" }}>
                  {m === "single" ? "Single" : "Bulk / CSV"}
                </button>
              ))}
            </div>
          )}

          {!bulkOnly && mode === "single" ? (
            <>
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Reed" />
              {roles && roles.length > 0 && (
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
                placeholder={bulkOnly
                  ? "email,name,company,discount,months\njordan@acme.com,Jordan Reed,Acme Inc.,10,12"
                  : "email,name,department,role\nsam@co.com,Sam Lee,Engineering,client"}
                className="rounded-lg border p-3 font-mono text-xs" style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text)" }} />
              {bulkOnly ? (
                <CompaniesCsvStatus
                  missingMsg={companyMissingMsg}
                  rowErrors={companyParsed.rowErrors}
                  rowWarnings={companyParsed.rowWarnings}
                  validCount={companyParsed.recipients.length}
                />
              ) : (
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <Users size={13} /> {memberParsed.recipients.length} valid recipient{memberParsed.recipients.length === 1 ? "" : "s"}
                  {memberParsed.errors.length > 0 ? <span style={{ color: "var(--warn)" }}>· {memberParsed.errors.length} skipped</span> : null}
                </div>
              )}
            </>
          )}
          {err && <p className="text-xs" style={{ color: "var(--risk)" }}>{err}</p>}
        </div>
      )}
    </Modal>
  );
}

/** Status panel under the CSV box for the companies variant. */
function CompaniesCsvStatus({
  missingMsg, rowErrors, rowWarnings, validCount,
}: {
  missingMsg:  string | null;
  rowErrors:   string[];
  rowWarnings: string[];
  validCount:  number;
}) {
  if (missingMsg) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
        style={{
          borderColor: "var(--risk)",
          background:  "color-mix(in srgb, var(--risk) 8%, transparent)",
          color:       "var(--text)",
        }}
      >
        <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: "var(--risk)" }} />
        <span>{missingMsg}</span>
      </div>
    );
  }

  // Errors and warnings are independent; both can render at once. Errors
  // block Send; warnings don't.
  return (
    <div className="flex flex-col gap-2">
      {rowErrors.length > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--risk)",
            background:  "color-mix(in srgb, var(--risk) 8%, transparent)",
            color:       "var(--text)",
          }}
        >
          <div className="flex items-center gap-1.5 font-medium" style={{ color: "var(--risk)" }}>
            <AlertTriangle size={13} />
            {rowErrors.length} row{rowErrors.length === 1 ? "" : "s"} need fixing
          </div>
          <ul className="ml-4 list-disc space-y-0.5" style={{ color: "var(--text-muted)" }}>
            {rowErrors.slice(0, 8).map((msg, i) => <li key={i}>{msg}</li>)}
            {rowErrors.length > 8 && (
              <li style={{ color: "var(--text-faint)" }}>… and {rowErrors.length - 8} more.</li>
            )}
          </ul>
        </div>
      )}
      {rowWarnings.length > 0 && (
        <div
          className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--warn)",
            background:  "color-mix(in srgb, var(--warn) 8%, transparent)",
            color:       "var(--text)",
          }}
        >
          <div className="flex items-center gap-1.5 font-medium" style={{ color: "var(--warn)" }}>
            <AlertTriangle size={13} />
            {rowWarnings.length} notice{rowWarnings.length === 1 ? "" : "s"}
          </div>
          <ul className="ml-4 list-disc space-y-0.5" style={{ color: "var(--text-muted)" }}>
            {rowWarnings.slice(0, 8).map((msg, i) => <li key={i}>{msg}</li>)}
            {rowWarnings.length > 8 && (
              <li style={{ color: "var(--text-faint)" }}>… and {rowWarnings.length - 8} more.</li>
            )}
          </ul>
        </div>
      )}
      {rowErrors.length === 0 && (
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Users size={13} /> {validCount} valid recipient{validCount === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

/** "a", "a and b", "a, b and c". */
function joinNaturally(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Tiny re-export so callers can render a trigger consistently if desired. */
export function inviteHint(): ReactNode { return null; }
