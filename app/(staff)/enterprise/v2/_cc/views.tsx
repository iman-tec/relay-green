"use client";

/*
 * Enterprise command center — secondary views (Members, Usage, Settings,
 * Resources). Members owns inviting in-console; Usage is read-only.
 */

import { useCallback, useEffect, useState } from "react";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import {
  StatusDot,
  type PortalStatus,
} from "@/app/_components/portal/StatusDot";
import { DrillPanel } from "@/app/_components/portal/DrillPanel";
import {
  Modal,
  ModalField,
  modalInputClass,
  modalInputStyle,
} from "@/app/_components/portal/Modal";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { createClient } from "@/lib/supabase/browser";
import type { EntMe } from "./types";

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1080px] px-10 py-9">
      <h1
        className="mb-7 font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        {title}
      </h1>
      {children}
    </div>
  );
}

// ---- Members (org-wide roster + management) --------------------------------
type EntMember = {
  id: string;
  displayName: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  spendCents: number;
  status: string;
  lastSignIn: string | null;
  createdAt: string;
};

export function MembersView() {
  const [members, setMembers] = useState<EntMember[] | null>(null);
  const [departments, setDepartments] = useState<
    { id: string; name: string }[]
  >([]);
  const [inviting, setInviting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/enterprise/members", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setMembers((d?.members ?? []) as EntMember[]);
        setDepartments(
          (d?.departments ?? []) as { id: string; name: string }[]
        );
      })
      .catch(() => setMembers([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const open = members?.find((m) => m.id === openId) ?? null;

  return (
    <Shell title="Members">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          Every employee across your departments. Add employees from a
          department in Overview.
        </p>
        <button
          type="button"
          onClick={() => setInviting(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white"
          style={{ background: "var(--primary)" }}
        >
          <span aria-hidden>＋</span> Invite admin
        </button>
      </div>
      {members === null ? (
        <Skel />
      ) : members.length === 0 ? (
        <Muted>
          No employees yet — add them from a department in Overview.
        </Muted>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                ["Name", "left"],
                ["Department", "left"],
                ["Min used", "right"],
                ["Min left", "right"],
                ["Spend", "right"],
                ["Status", "left"],
              ].map(([h, a]) => (
                <th
                  key={h}
                  className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
                  style={{
                    color: "var(--text-muted)",
                    textAlign: a as "left" | "right",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
              <th
                style={{ borderBottom: "1px solid var(--border)", width: 24 }}
                aria-hidden
              />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.id}
                onClick={() => setOpenId(m.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setOpenId(m.id)}
                className="group/row cursor-pointer outline-none"
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface-raised)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <td className="px-4 py-3 text-[14px] font-medium">
                  {m.displayName || m.email || "—"}
                </td>
                <td
                  className="px-4 py-3 text-[14px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {m.departmentName ?? "—"}
                </td>
                <Num>{int(m.usedMinutes)}</Num>
                <Num>{int(m.remainingMinutes)}</Num>
                <Num>{eur(m.spendCents)}</Num>
                <td className="px-4 py-3">
                  <StatusDot status={m.status as PortalStatus} />
                </td>
                <td
                  className="px-2 py-3 text-right text-[18px] opacity-0 transition-opacity group-hover/row:opacity-100"
                  style={{ color: "var(--text-faint)" }}
                  aria-hidden
                >
                  ⋯
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DrillPanel
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open?.displayName || open?.email || ""}
        subtitle={open ? (open.departmentName ?? "No department") : undefined}
      >
        {open && (
          <MemberDetail
            m={open}
            departments={departments}
            onChanged={() => {
              setOpenId(null);
              load();
            }}
          />
        )}
      </DrillPanel>

      <InviteMemberModal
        open={inviting}
        onClose={() => setInviting(false)}
        onInvited={() => {
          setInviting(false);
          load();
        }}
      />
    </Shell>
  );
}

function MemberDetail({
  m,
  departments,
  onChanged,
}: {
  m: EntMember;
  departments: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const suspended = m.status === "suspended";
  const pending = !m.lastSignIn;

  async function reassign() {
    if (!reassignTo || reassignTo === m.departmentId) return;
    setBusy("reassign");
    setErr(null);
    try {
      const r = await fetch(`/api/enterprise/members/${m.id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: reassignTo }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Reassign failed.");
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reassign failed.");
      setBusy(null);
    }
  }

  async function setStatus(next: "ACTIVE" | "DEACTIVATED") {
    setBusy("status");
    setErr(null);
    try {
      const r = await fetch(`/api/enterprise/members/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed.");
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
      setBusy(null);
    }
  }

  async function resend() {
    setBusy("resend");
    setErr(null);
    setNote(null);
    try {
      const r = await fetch(`/api/enterprise/members/${m.id}/resend-invite`, {
        method: "POST",
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed.");
      }
      setNote("Invite re-sent.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  async function refill() {
    const amt = Number(amount);
    if (!(amt > 0)) return;
    setBusy("refill");
    setErr(null);
    try {
      // Enterprise admin refills straight from the ORG WALLET
      // (transfer_org_to_employee) — works for any member regardless of dept.
      const r = await fetch(`/api/enterprise/members/${m.id}/refill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Refill failed.");
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refill failed.");
      setBusy(null);
    }
  }

  return (
    <>
      <div
        className="flex gap-8 border-y py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <MStat label="Allocated" v={int(m.allocatedMinutes)} />
        <MStat label="Used" v={int(m.usedMinutes)} />
        <MStat label="Remaining" v={int(m.remainingMinutes)} />
      </div>
      <Row k="Email" v={m.email || "—"} />
      <Row k="Department" v={m.departmentName ?? "—"} />
      <Row k="Spend" v={eur(m.spendCents)} />
      <Row
        k="Last activity"
        v={m.lastSignIn ? dateShort(m.lastSignIn) : "Never signed in"}
      />
      <Row k="Status" v={suspended ? "Suspended" : "Active"} />

      <div className="mt-5">
        <div
          className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Refill from org wallet
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Minutes"
            className="w-32 rounded-md border px-3 py-2 text-[14px] outline-none"
            style={modalInputStyle}
          />
          <button
            type="button"
            onClick={refill}
            disabled={busy !== null || !(Number(amount) > 0)}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity"
            style={{
              background: "var(--primary)",
              opacity: busy !== null || !(Number(amount) > 0) ? 0.5 : 1,
              cursor:
                busy !== null || !(Number(amount) > 0)
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {busy === "refill" ? "Adding…" : "Refill"}
          </button>
        </div>
      </div>

      {departments.length > 0 && (
        <div className="mt-5">
          <div
            className="mb-2 text-[12px] font-medium tracking-[0.04em] uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Department
          </div>
          <div className="flex gap-2">
            <select
              value={reassignTo || m.departmentId || ""}
              onChange={(e) => setReassignTo(e.target.value)}
              className="rounded-md border px-3 py-2 text-[14px] outline-none"
              style={modalInputStyle}
            >
              {!m.departmentId && <option value="">— none —</option>}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={reassign}
              disabled={
                busy !== null || !reassignTo || reassignTo === m.departmentId
              }
              className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity"
              style={{
                background: "var(--primary)",
                opacity:
                  busy !== null || !reassignTo || reassignTo === m.departmentId
                    ? 0.5
                    : 1,
                cursor:
                  busy !== null || !reassignTo || reassignTo === m.departmentId
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {busy === "reassign" ? "Moving…" : "Reassign"}
            </button>
          </div>
        </div>
      )}

      <div
        className="mt-6 flex flex-wrap gap-2 border-t pt-4"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => setStatus(suspended ? "ACTIVE" : "DEACTIVATED")}
          disabled={busy !== null}
          className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-50"
          style={{
            borderColor: suspended ? "var(--primary)" : "var(--risk)",
            color: suspended ? "var(--primary-hover)" : "var(--risk)",
          }}
        >
          {busy === "status"
            ? "…"
            : suspended
              ? "Reactivate access"
              : "Suspend access"}
        </button>
        {pending && (
          <button
            type="button"
            onClick={resend}
            disabled={busy !== null}
            className="rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-opacity disabled:opacity-50"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }}
          >
            {busy === "resend" ? "…" : "Resend invite"}
          </button>
        )}
      </div>
      {note && (
        <p
          className="mt-2 text-[13px]"
          style={{ color: "var(--primary-hover)" }}
        >
          {note}
        </p>
      )}
      {err && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--risk)" }}>
          {err}
        </p>
      )}
      <p className="mt-3 text-[12px]" style={{ color: "var(--text-faint)" }}>
        Suspending blocks the member’s sign-in immediately (server-enforced);
        reactivating restores access.
      </p>
    </>
  );
}

function MStat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div
        className="mb-1.5 text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[19px] tabular-nums"
        style={{ color: "var(--text)" }}
      >
        {v}
      </div>
    </div>
  );
}

function InviteMemberModal({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSubmit = emailOk && name.trim().length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/enterprise/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          displayName: name.trim(),
          role: "enterprise_admin",
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Invite failed.");
      }
      setEmail("");
      setName("");
      onInvited();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Invite failed.");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite admin">
      <form onSubmit={submit}>
        <ModalField label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className={modalInputClass}
            style={modalInputStyle}
          />
        </ModalField>
        <ModalField label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@acme.com"
            className={modalInputClass}
            style={modalInputStyle}
          />
        </ModalField>
        {err && (
          <p className="mb-3 text-[13px]" style={{ color: "var(--risk)" }}>
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg px-4 py-2.5 text-[14px] font-semibold text-white transition-opacity"
          style={{
            background: "var(--primary)",
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </form>
    </Modal>
  );
}

// ---- Usage -----------------------------------------------------------------
export function UsageView() {
  const [data, setData] = useState<{
    byPeriod?: {
      period: string;
      minutes: number;
      sessions: number;
      spendCents: number;
      suppressed?: boolean;
      suppressedLabel?: string;
    }[];
  } | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !off && setData(d ?? {}))
      .catch(() => setData({}));
    return () => {
      off = true;
    };
  }, []);
  const rows = data?.byPeriod ?? [];
  return (
    <Shell title="Usage">
      {data === null ? (
        <Skel />
      ) : rows.length === 0 ? (
        <Muted>No usage in the reporting window yet.</Muted>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                ["Month", "left"],
                ["Sessions", "right"],
                ["Minutes", "right"],
                ["Spend", "right"],
              ].map(([h, a]) => (
                <th
                  key={h}
                  className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
                  style={{
                    color: "var(--text-muted)",
                    textAlign: a as "left" | "right",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.period}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-4 py-3 text-[14px]">{r.period}</td>
                {r.suppressed ? (
                  <td
                    colSpan={3}
                    className="px-4 py-3 text-right text-[13px]"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {r.suppressedLabel ?? "Insufficient data"}
                  </td>
                ) : (
                  <>
                    <Num>{int(r.sessions)}</Num>
                    <Num>{int(r.minutes)}</Num>
                    <Num>{eur(r.spendCents)}</Num>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

// ---- Settings --------------------------------------------------------------
function settingsErr(code: string | undefined): string {
  switch (code) {
    case "name_required":
      return "Name is required.";
    case "name_too_long":
      return "That name is too long.";
    case "invalid_domain":
      return "That domain doesn't look right (use a bare host like acme.com).";
    case "domain_taken":
      return "That domain is already used by another organization.";
    case "invalid_retention":
      return "Pick a valid retention window.";
    default:
      return code ? `Couldn't save (${code}).` : "Couldn't save.";
  }
}

export function SettingsView({
  me,
  onChanged,
}: {
  me: EntMe | null;
  onChanged?: () => void;
}) {
  const cp = me?.channelPartner;

  // ── Your profile (the caller's own user — name editable, email read-only).
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    void (async () => {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (off || !u.user) return;
      setProfileEmail(u.user.email ?? "");
      const { data: p } = await sb
        .from("profiles")
        .select("full_name")
        .eq("id", u.user.id)
        .maybeSingle();
      if (off) return;
      setProfileName(
        (p as { full_name: string | null } | null)?.full_name ?? ""
      );
      setProfileLoaded(true);
    })();
    return () => {
      off = true;
    };
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const r = await fetch("/api/enterprise/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: profileName.trim() }),
      });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(settingsErr(b.error));
      setProfileMsg("Saved.");
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Organization (name / domain / retention → PATCH /api/enterprise/org).
  const [orgName, setOrgName] = useState("");
  const [orgDomain, setOrgDomain] = useState("");
  const [orgRetention, setOrgRetention] = useState(0);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgMsg, setOrgMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    // Seed the editable org fields once the async snapshot lands. Synchronous
    // prop→state sync is intentional here (the form must reflect server truth
    // on first load and after a refetch).
    /* eslint-disable react-hooks/set-state-in-effect */
    setOrgName(me.org.name ?? "");
    setOrgDomain(me.org.primaryDomain ?? "");
    setOrgRetention(me.org.retentionDays ?? 0);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [me]);

  // ── Org MSA acceptance record (read-only) — the clickwrap gate captures the
  // signature on first sign-in; this surfaces the accepted version + date.
  const [terms, setTerms] = useState<{
    version?: string;
    termsVersion?: string;
    acceptedAt?: string | null;
    needsAcceptance?: boolean;
  } | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/accept-msa", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!off) setTerms(d);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const saveOrg = async () => {
    setSavingOrg(true);
    setOrgMsg(null);
    try {
      const r = await fetch("/api/enterprise/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgName.trim(),
          primaryDomain: orgDomain.trim(),
          retentionDays: orgRetention,
        }),
      });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(settingsErr(b.error));
      setOrgMsg("Saved.");
      onChanged?.();
    } catch (e) {
      setOrgMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingOrg(false);
    }
  };

  return (
    <Shell title="Settings">
      {/* Your profile */}
      <Section title="Your profile">
        <EditRow label="Name">
          <input
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Your name"
            disabled={!profileLoaded}
            className={modalInputClass}
            style={modalInputStyle}
          />
        </EditRow>
        <Row k="Email" v={profileEmail || "—"} />
        <SaveBar
          onClick={saveProfile}
          busy={savingProfile}
          disabled={!profileName.trim() || !profileLoaded}
          msg={profileMsg}
        />
      </Section>

      {/* Organization */}
      <Section title="Organization">
        <EditRow label="Name">
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Acme Inc."
            disabled={!me}
            className={modalInputClass}
            style={modalInputStyle}
          />
        </EditRow>
        <EditRow label="Primary domain">
          <input
            value={orgDomain}
            onChange={(e) => setOrgDomain(e.target.value)}
            placeholder="acme.com"
            disabled={!me}
            className={modalInputClass}
            style={modalInputStyle}
          />
        </EditRow>
        <EditRow label="Data retention">
          <select
            value={orgRetention}
            onChange={(e) => setOrgRetention(Number(e.target.value))}
            disabled={!me}
            className={modalInputClass}
            style={modalInputStyle}
          >
            <option value={0}>Indefinite</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </EditRow>
        <Row k="Enterprise code" v={me?.org.enterpriseCode ?? "—"} mono />
        <SaveBar
          onClick={saveOrg}
          busy={savingOrg}
          disabled={!orgName.trim() || !me}
          msg={orgMsg}
        />
      </Section>

      {/* Appearance */}
      <Section title="Appearance">
        <div
          className="flex items-center justify-between border-b py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Theme
          </span>
          <ThemeTriplet />
        </div>
      </Section>

      {cp && (
        <Section title="Channel partner">
          <Row k="Partner" v={cp.name} />
          <Row k="Your discount" v={`${me?.org.discountPct ?? 0}%`} />
          <Row
            k="Through"
            v={me?.org.discountUntil ? dateShort(me.org.discountUntil) : "—"}
          />
        </Section>
      )}

      <Section title="Contract">
        <Row
          k="Master Services Agreement"
          v={
            terms?.version || terms?.termsVersion
              ? `v${terms.version ?? terms.termsVersion}`
              : "—"
          }
        />
        <Row
          k="Accepted"
          v={
            terms?.acceptedAt
              ? new Date(terms.acceptedAt).toLocaleDateString()
              : terms?.needsAcceptance
                ? "Not yet accepted"
                : "—"
          }
        />
        <a
          href="/legal/terms-commercial"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[13px] no-underline"
          style={{ color: "var(--primary-hover)" }}
        >
          View the agreement ↗
        </a>
        <p
          className="mt-1.5 text-[12px]"
          style={{ color: "var(--text-faint)" }}
        >
          The agreement is accepted via clickwrap on first sign-in and binds
          your departments + members.
        </p>
      </Section>
    </Shell>
  );
}

function EditRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="shrink-0 text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <div className="w-[260px] max-w-[60%]">{children}</div>
    </div>
  );
}

function SaveBar({
  onClick,
  busy,
  disabled,
  msg,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  msg: string | null;
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || disabled}
        className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity"
        style={{
          background: "var(--primary)",
          opacity: busy || disabled ? 0.5 : 1,
          cursor: busy || disabled ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {msg && (
        <span
          className="text-[12px]"
          style={{
            color: msg === "Saved." ? "var(--primary-hover)" : "var(--risk)",
          }}
        >
          {msg}
        </span>
      )}
    </div>
  );
}

// ---- Resources -------------------------------------------------------------
const VIDEOS = [
  { src: "/relay-explainer-final-v5.mp4", label: "Product overview" },
  { src: "/relay-explainer-enterprise-v1.mp4", label: "For enterprises" },
];

export function ResourcesView() {
  return (
    <Shell title="Resources">
      <section className="mb-10">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Guides
        </h2>
        <div className="flex flex-wrap gap-2.5">
          <a
            href="/enterprise-guide.pdf"
            download
            className="rounded-lg border px-3.5 py-2 text-[13px] font-medium no-underline"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }}
          >
            ↓ Admin guide (PDF)
          </a>
          <a
            href="/onboarding-employees.pdf"
            download
            className="rounded-lg border px-3.5 py-2 text-[13px] font-medium no-underline"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }}
          >
            ↓ Onboarding employees (PDF)
          </a>
        </div>
      </section>
      <section>
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Videos
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {VIDEOS.map((v) => (
            <figure key={v.src}>
              <video
                src={v.src}
                controls
                preload="metadata"
                poster="/relay-explainer-v6-poster.jpg"
                className="w-full rounded-xl border"
                style={{ borderColor: "var(--border)", aspectRatio: "16/10" }}
              />
              <figcaption
                className="mt-2 text-[13px]"
                style={{ color: "var(--text-muted)" }}
              >
                {v.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </Shell>
  );
}

// ---- shared bits -----------------------------------------------------------
function Num({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
      {children}
    </td>
  );
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 max-w-md">
      <h2
        className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div
      className="flex items-center justify-between border-b py-3"
      style={{ borderColor: "var(--border)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        {k}
      </span>
      <span className={`text-[14px] font-medium ${mono ? "font-mono" : ""}`}>
        {v}
      </span>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}
function Skel() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[45px] border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mt-3 h-4 w-40 rounded"
            style={{ background: "var(--surface-raised)" }}
          />
        </div>
      ))}
    </div>
  );
}
