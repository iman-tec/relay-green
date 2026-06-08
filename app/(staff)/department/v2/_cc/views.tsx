"use client";

/* Department command center — secondary views (Sessions, Usage, Settings,
 * Resources). Read-only; reuse existing department endpoints. */

import { useEffect, useState } from "react";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
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

// ---- Sessions --------------------------------------------------------------
type Sess = {
  id: string;
  status: string;
  createdAt: string;
  durationMinutes: number;
  customerName?: string;
  engineerName?: string;
};

export function SessionsView() {
  const [rows, setRows] = useState<Sess[] | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/department/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !off && setRows((d?.sessions ?? []) as Sess[]))
      .catch(() => setRows([]));
    return () => {
      off = true;
    };
  }, []);
  return (
    <Shell title="Sessions">
      {rows === null ? (
        <Skel />
      ) : rows.length === 0 ? (
        <Muted>No sessions yet.</Muted>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                ["When", "left"],
                ["Status", "left"],
                ["Minutes", "right"],
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
            {rows.map((s) => (
              <tr
                key={s.id}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td
                  className="px-4 py-3 text-[14px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {dateShort(s.createdAt)}
                </td>
                <td className="px-4 py-3 text-[14px]">{s.status}</td>
                <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
                  {int(s.durationMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
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
    fetch("/api/department/usage", { cache: "no-store" })
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
                    <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
                      {int(r.sessions)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
                      {int(r.minutes)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[14px] tabular-nums">
                      {eur(r.spendCents)}
                    </td>
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

      {/* Appearance */}
      <section className="mb-8 max-w-md">
        <h2
          className="mb-3 text-[13px] font-medium tracking-[0.04em] uppercase"
          style={{ color: "var(--text)" }}
        >
          Appearance
        </h2>
        <div
          className="flex items-center justify-between border-b py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Theme
          </span>
          <ThemeTriplet />
        </div>
      </section>

      {/* Terms (notice, not a re-sign) */}
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
          sessions under the Sessions tab.
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
