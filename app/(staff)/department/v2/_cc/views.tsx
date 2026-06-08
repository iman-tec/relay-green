"use client";

/* Department command center — secondary views (Sessions, Usage, Settings,
 * Resources). Read-only; reuse existing department endpoints. */

import { useEffect, useState } from "react";
import { eur, int } from "@/app/_components/portal/format";
import { createClient } from "@/lib/supabase/browser";
import type { DeptData } from "./types";

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

// ---- Usage -----------------------------------------------------------------
type UsageMember = {
  id: string;
  name: string;
  email: string;
  status: string;
  sessions: number;
  minutes: number;
  spendCents: number;
  remainingMinutes: number;
  lastSessionAt: string | null;
  liveNow: boolean;
  dormant: boolean;
};
type UsageProject = {
  project: string;
  sessions: number;
  minutes: number;
  spendCents: number;
};
type UsagePeriod = {
  period: string;
  minutes: number | null;
  sessions: number | null;
  spendCents: number | null;
  suppressed?: boolean;
  suppressedLabel?: string;
};
type UsageBudget = {
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  spendToDateCents: number;
  dailyBurnMinutes: number;
  runoutDays: number | null;
  runoutDate: string | null;
  estimate: boolean;
};
type UsagePayload = {
  byMember: UsageMember[];
  byProject: UsageProject[];
  byPeriod: UsagePeriod[];
  budget: UsageBudget;
  totalLiveNow: number;
  perMinuteCents: number;
};

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function UsageView() {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let off = false;
    fetch("/api/department/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((d) => !off && setData(d as UsagePayload))
      .catch(() => !off && setErr(true));
    return () => {
      off = true;
    };
  }, []);

  function exportCsv() {
    if (!data) return;
    const head = [
      "Member",
      "Email",
      "Status",
      "Sessions",
      "Minutes",
      "Spend (EUR)",
      "Last session",
    ];
    const rows = data.byMember.map((m) => [
      m.name,
      m.email,
      m.dormant ? "dormant" : m.status,
      m.sessions,
      m.minutes,
      (m.spendCents / 100).toFixed(2),
      m.lastSessionAt ? new Date(m.lastSessionAt).toISOString().slice(0, 10) : "",
    ]);
    const csv = [head, ...rows]
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "department-usage.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (err)
    return (
      <Shell title="Usage">
        <Muted>Couldn&apos;t load usage. Try again shortly.</Muted>
      </Shell>
    );
  if (data === null)
    return (
      <Shell title="Usage">
        <Skel />
      </Shell>
    );

  const b = data.budget;
  const burn = b.dailyBurnMinutes;

  return (
    <Shell title="Usage">
      {/* Budget & runway */}
      <section className="mb-9">
        <div className="mb-3 flex flex-wrap items-center gap-x-12 gap-y-4">
          <Stat label="Allocated" value={int(b.allocatedMinutes)} unit="min" />
          <Stat label="Used" value={int(b.usedMinutes)} unit="min" />
          <Stat label="Left" value={int(b.remainingMinutes)} unit="min" />
          <Stat label="Spend · to date" value={eur(b.spendToDateCents)} />
          <Stat
            label="Live now"
            value={int(data.totalLiveNow)}
            accent={data.totalLiveNow > 0 ? "var(--ok)" : undefined}
          />
        </div>
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          {burn > 0 && b.runoutDays != null ? (
            <>
              At ~{burn}/day, the department&apos;s minutes run out in about{" "}
              <span style={{ color: "var(--text)" }}>{b.runoutDays} days</span>
              {b.runoutDate ? ` (around ${shortDate(b.runoutDate)})` : ""} —
              estimate. Your enterprise admin tops up the department pool.
            </>
          ) : (
            "Not enough recent usage to project a run-out date yet."
          )}
        </p>
      </section>

      {/* By member */}
      <SectionHead
        title="By member"
        right={
          <button
            type="button"
            onClick={exportCsv}
            disabled={data.byMember.length === 0}
            className="rounded-md border px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            ↓ Export CSV
          </button>
        }
      />
      {data.byMember.length === 0 ? (
        <Muted>No members yet — invite employees to start tracking usage.</Muted>
      ) : (
        <table className="mb-9 w-full border-collapse">
          <THead
            cols={[
              ["Member", "left"],
              ["Last session", "left"],
              ["Sessions", "right"],
              ["Minutes", "right"],
              ["Spend", "right"],
            ]}
          />
          <tbody>
            {data.byMember.map((m) => (
              <tr
                key={m.id}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {m.liveNow && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.04em] uppercase"
                        style={{ background: "var(--ok)", color: "#fff" }}
                      >
                        ● Live
                      </span>
                    )}
                    <div className="min-w-0">
                      <div
                        className="text-[14px] font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {m.name || "—"}
                        {m.dormant && (
                          <span
                            className="ml-2 text-[11px] font-normal"
                            style={{ color: "var(--text-faint)" }}
                          >
                            dormant
                          </span>
                        )}
                      </div>
                      <div
                        className="truncate text-[12px]"
                        style={{ color: "var(--text-muted)" }}
                        title={m.email}
                      >
                        {m.email || "—"}
                      </div>
                    </div>
                  </div>
                </td>
                <td
                  className="px-4 py-3 text-[14px]"
                  style={{
                    color: m.dormant
                      ? "var(--text-faint)"
                      : "var(--text-muted)",
                  }}
                >
                  {shortDate(m.lastSessionAt)}
                </td>
                <UNum em={m.dormant}>{int(m.sessions)}</UNum>
                <UNum em={m.dormant}>{int(m.minutes)}</UNum>
                <UNum em={m.dormant}>{eur(m.spendCents)}</UNum>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* By project */}
      <SectionHead title="By project" />
      {data.byProject.length === 0 ? (
        <Muted>No project activity in the reporting window yet.</Muted>
      ) : (
        <table className="mb-9 w-full border-collapse">
          <THead
            cols={[
              ["Project", "left"],
              ["Sessions", "right"],
              ["Minutes", "right"],
              ["Spend", "right"],
            ]}
          />
          <tbody>
            {data.byProject.map((p) => (
              <tr
                key={p.project}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-4 py-3 text-[14px]">{p.project}</td>
                <UNum>{int(p.sessions)}</UNum>
                <UNum>{int(p.minutes)}</UNum>
                <UNum>{eur(p.spendCents)}</UNum>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Monthly trend */}
      <SectionHead title="Monthly trend" />
      {data.byPeriod.length === 0 ? (
        <Muted>No usage in the reporting window yet.</Muted>
      ) : (
        <table className="w-full border-collapse">
          <THead
            cols={[
              ["Month", "left"],
              ["Sessions", "right"],
              ["Minutes", "right"],
              ["Spend", "right"],
            ]}
          />
          <tbody>
            {data.byPeriod.map((r) => (
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
                    <UNum>{int(r.sessions ?? 0)}</UNum>
                    <UNum>{int(r.minutes ?? 0)}</UNum>
                    <UNum>{eur(r.spendCents ?? 0)}</UNum>
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

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <div>
      <div
        className="mb-1 text-[12px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[20px] tabular-nums"
        style={{ color: accent ?? "var(--text)" }}
      >
        {value}
        {unit && (
          <span
            className="ml-1 text-[12px]"
            style={{ color: "var(--text-faint)" }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHead({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2
        className="text-[13px] font-medium tracking-[0.04em] uppercase"
        style={{ color: "var(--text)" }}
      >
        {title}
      </h2>
      {right}
    </div>
  );
}

function THead({ cols }: { cols: [string, "left" | "right"][] }) {
  return (
    <thead>
      <tr>
        {cols.map(([h, a]) => (
          <th
            key={h}
            className="px-4 pb-2.5 text-[12px] font-medium tracking-[0.04em] uppercase"
            style={{
              color: "var(--text-muted)",
              textAlign: a,
              borderBottom: "1px solid var(--border)",
            }}
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function UNum({
  children,
  em,
}: {
  children: React.ReactNode;
  em?: boolean;
}) {
  return (
    <td
      className="px-4 py-3 text-right font-mono text-[14px] tabular-nums"
      style={{ color: em ? "var(--text-faint)" : "var(--text)" }}
    >
      {children}
    </td>
  );
}

// ---- Settings (with downstream terms NOTICE — never a second contract) -----
export function SettingsView({ data }: { data: DeptData | null }) {
  // Caller's own profile (name editable, email read-only).
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void (async () => {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (off || !u.user) return;
      setEmail(u.user.email ?? "");
      const { data: p } = await sb
        .from("profiles")
        .select("full_name")
        .eq("id", u.user.id)
        .maybeSingle();
      if (off) return;
      setName((p as { full_name: string | null } | null)?.full_name ?? "");
      setLoaded(true);
    })();
    return () => {
      off = true;
    };
  }, []);
  const saveName = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      if (!res.ok) throw new Error("Couldn't save.");
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell title="Settings">
      {/* Your profile */}
      <section className="mb-8 max-w-md">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Your profile
        </h2>
        <div
          className="flex items-center justify-between gap-4 border-b py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={!loaded}
            className="w-[260px] max-w-[60%] rounded-md border px-3 py-2 text-[14px] outline-none"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--surface)",
            }}
          />
        </div>
        <Row k="Email" v={email || "—"} />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={saveName}
            disabled={saving || !name.trim() || !loaded}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity"
            style={{
              background: "var(--primary)",
              opacity: saving || !name.trim() || !loaded ? 0.5 : 1,
              cursor:
                saving || !name.trim() || !loaded ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {msg && (
            <span
              className="text-[12px]"
              style={{
                color:
                  msg === "Saved." ? "var(--primary-hover)" : "var(--risk)",
              }}
            >
              {msg}
            </span>
          )}
        </div>
      </section>

      {/* Department (read-only — dept admins don't rename their dept) */}
      <section className="mb-8 max-w-md">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Department
        </h2>
        <Row k="Name" v={data?.department.name ?? "—"} />
        <Row k="Code" v={data?.department.departmentCode ?? "—"} mono />
        <Row k="Organization" v={data?.enterprise.name ?? "—"} />
      </section>

      {/* Terms (notice + viewer — view-only for a department admin) */}
      <section className="mb-8 max-w-md">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Terms
        </h2>
        <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
          You act under your organization&apos;s agreement with Relay. Your
          enterprise admin accepts the terms on the organization&apos;s behalf —
          there&apos;s nothing to sign here.
        </p>
        <a
          href="/legal/terms-of-use"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[13px] font-medium"
          style={{ color: "var(--primary-hover)" }}
        >
          View terms ↗
        </a>
      </section>

      {/* Data retention (view) */}
      <section className="max-w-md">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Data retention
        </h2>
        <p className="text-[14px]" style={{ color: "var(--text-muted)" }}>
          Retention is set at the organization level by your enterprise admin.
          Session data is kept per that policy; you can view your department’s
          sessions under the Supervise tab.
        </p>
      </section>
    </Shell>
  );
}

// ---- Resources -------------------------------------------------------------
export function ResourcesView() {
  return (
    <Shell title="Resources">
      <section>
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Videos
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <figure>
            <video
              src="/relay-explainer-final-v5.mp4"
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
              Product overview
            </figcaption>
          </figure>
        </div>
      </section>
    </Shell>
  );
}

// ---- shared bits -----------------------------------------------------------
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
