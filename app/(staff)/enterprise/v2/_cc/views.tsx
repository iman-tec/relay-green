"use client";

/*
 * Enterprise command center — secondary views (Members, Settings, Resources).
 * Members owns inviting in-console (employees into a department + org admins).
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

type InviteMode = "member" | "admin" | null;

export function MembersView() {
  const [members, setMembers] = useState<EntMember[] | null>(null);
  const [departments, setDepartments] = useState<
    { id: string; name: string }[]
  >([]);
  const [inviteMode, setInviteMode] = useState<InviteMode>(null);
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
  // Poll so minute / status / spend values stay current without a manual
  // refresh (realtime is non-functional; 20s mirrors the other consoles).
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const open = members?.find((m) => m.id === openId) ?? null;

  return (
    <Shell title="Members">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p
          className="max-w-md text-[13px]"
          style={{ color: "var(--text-muted)" }}
        >
          Every employee across your departments. Invite a member into a
          department, or invite an organization admin.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setInviteMode("admin")}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }}
          >
            Invite admin
          </button>
          <button
            type="button"
            onClick={() => setInviteMode("member")}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white"
            style={{ background: "var(--primary)" }}
          >
            <span aria-hidden>＋</span> Invite a member
          </button>
        </div>
      </div>
      {members === null ? (
        <Skel />
      ) : members.length === 0 ? (
        <Muted>
          No members yet — use “Invite a member” to add an employee to a
          department.
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
                  className="px-2 py-3 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MemberRowMenu
                    m={m}
                    departments={departments}
                    onChanged={load}
                  />
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
        mode={inviteMode}
        departments={departments}
        onClose={() => setInviteMode(null)}
        onInvited={() => {
          setInviteMode(null);
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
  mode,
  departments,
  onClose,
  onInvited,
}: {
  mode: "member" | "admin" | null;
  departments: { id: string; name: string }[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const isMember = mode === "member";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [deptId, setDeptId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset the per-open fields whenever the modal (re)opens in a given mode.
  useEffect(() => {
    if (mode) {
      setEmail("");
      setName("");
      setDeptId("");
      setErr(null);
      setBusy(false);
    }
  }, [mode]);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  // A member must be placed in a department; an admin must not.
  const canSubmit =
    emailOk &&
    name.trim().length > 0 &&
    !busy &&
    (!isMember || deptId.length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/enterprise/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isMember
            ? {
                email: email.trim(),
                displayName: name.trim(),
                role: "client",
                departmentId: deptId,
              }
            : {
                email: email.trim(),
                displayName: name.trim(),
                role: "enterprise_admin",
              }
        ),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Invite failed.");
      }
      onInvited();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Invite failed.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      title={isMember ? "Invite a member" : "Invite admin"}
    >
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
        {isMember && (
          <ModalField label="Department">
            <select
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className={modalInputClass}
              style={modalInputStyle}
            >
              <option value="">— Choose a department —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </ModalField>
        )}
        <p className="mb-3 text-[12px]" style={{ color: "var(--text-faint)" }}>
          {isMember
            ? "The member joins this department and verifies via an email magic-link. Minutes are billed from the department pool."
            : "An organization admin manages all departments. They aren’t placed in a department."}
        </p>
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
          {busy ? "Inviting…" : isMember ? "Send member invite" : "Send invite"}
        </button>
      </form>
    </Modal>
  );
}

/* ── Per-member row action menu (the `…`) — a real dropdown on every row.
 * Full inline controls: refill from org wallet, change department,
 * suspend/reactivate, resend invite. Hits the same endpoints as the drill
 * panel; outside-click + Escape close. */
function MemberRowMenu({
  m,
  departments,
  onChanged,
}: {
  m: EntMember;
  departments: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [deptSel, setDeptSel] = useState(m.departmentId ?? "");
  const ref = useRef<HTMLDivElement>(null);

  const suspended = m.status === "suspended";
  const pending = !m.lastSignIn;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function call(
    key: string,
    url: string,
    init: RequestInit,
    after?: () => void
  ) {
    setBusy(key);
    setErr(null);
    try {
      const r = await fetch(url, init);
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Action failed.");
      }
      after?.();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const refill = () => {
    const amt = Number(amount);
    if (!(amt > 0)) return;
    void call(
      "refill",
      `/api/enterprise/members/${m.id}/refill`,
      json({ amount: amt }),
      () => setAmount("")
    );
  };
  const moveDept = () => {
    if (!deptSel || deptSel === m.departmentId) return;
    void call(
      "dept",
      `/api/enterprise/members/${m.id}/reassign`,
      json({ departmentId: deptSel })
    );
  };
  const setStatus = (next: "ACTIVE" | "DEACTIVATED", after?: () => void) =>
    void call(
      "status",
      `/api/enterprise/members/${m.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      },
      after
    );
  // Bottom toggle closes the menu; the in-place "reactivate to refill" prompt
  // keeps it open so the admin can refill immediately after.
  const toggleStatus = () =>
    setStatus(suspended ? "ACTIVE" : "DEACTIVATED", () => setOpen(false));
  const reactivateInPlace = () => setStatus("ACTIVE");
  const resend = () =>
    void call("resend", `/api/enterprise/members/${m.id}/resend-invite`, {
      method: "POST",
    });

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Member actions"
        onClick={() => setOpen((v) => !v)}
        className="grid size-7 place-items-center rounded-md text-[18px] leading-none transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
        style={{ color: "var(--text-muted)" }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-[252px] rounded-xl border p-3 shadow-2xl"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {/* Refill — blocked while suspended; ask to reactivate first. */}
          <div
            className="mb-1 text-[11px] font-medium tracking-[0.04em] uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Refill from org wallet
          </div>
          {suspended ? (
            <div
              className="mb-3 rounded-md border px-2.5 py-2"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface-raised)",
              }}
            >
              <p className="mb-2 text-[12px]" style={{ color: "var(--text)" }}>
                This member is suspended. Reactivate access before refilling
                minutes.
              </p>
              <button
                type="button"
                onClick={reactivateInPlace}
                disabled={busy !== null}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: "var(--primary)" }}
              >
                {busy === "status" ? "…" : "Reactivate access"}
              </button>
            </div>
          ) : (
            <div className="mb-3 flex gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Minutes"
                className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
                style={modalInputStyle}
              />
              <button
                type="button"
                onClick={refill}
                disabled={busy !== null || !(Number(amount) > 0)}
                className="shrink-0 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: "var(--primary)" }}
              >
                {busy === "refill" ? "…" : "Refill"}
              </button>
            </div>
          )}

          {/* Change department */}
          {departments.length > 0 && (
            <>
              <div
                className="mb-1 text-[11px] font-medium tracking-[0.04em] uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Department
              </div>
              <div className="mb-3 flex gap-2">
                <select
                  value={deptSel}
                  onChange={(e) => setDeptSel(e.target.value)}
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
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
                  onClick={moveDept}
                  disabled={
                    busy !== null || !deptSel || deptSel === m.departmentId
                  }
                  className="shrink-0 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: "var(--primary)" }}
                >
                  {busy === "dept" ? "…" : "Move"}
                </button>
              </div>
            </>
          )}

          {/* Suspend / Reactivate + Resend */}
          <div
            className="flex flex-col gap-1 border-t pt-2"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={toggleStatus}
              disabled={busy !== null}
              className="w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.05]"
              style={{
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
                role="menuitem"
                onClick={resend}
                disabled={busy !== null}
                className="w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.05]"
                style={{ color: "var(--text)" }}
              >
                {busy === "resend" ? "…" : "Resend invite"}
              </button>
            )}
          </div>

          {err && (
            <p className="mt-2 text-[12px]" style={{ color: "var(--risk)" }}>
              {err}
            </p>
          )}
        </div>
      )}
    </div>
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
