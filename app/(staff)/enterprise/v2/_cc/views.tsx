"use client";

/*
 * Enterprise command center — secondary views (Members, Usage, Settings,
 * Resources). Each reuses an existing enterprise endpoint, read-only here;
 * mutation forms stay in the legacy console for now (break-nothing).
 */

import { useEffect, useState } from "react";
import { eur, int, dateShort } from "@/app/_components/portal/format";
import {
  StatusDot,
  type PortalStatus,
} from "@/app/_components/portal/StatusDot";
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

const RATE = 300;

// ---- Members ---------------------------------------------------------------
type Member = {
  id: string;
  displayName: string;
  email: string;
  primaryRole: string;
  status: string;
};

export function MembersView() {
  const [members, setMembers] = useState<Member[] | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/enterprise/users?scope=staff", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!off) setMembers((d?.members ?? d?.users ?? []) as Member[]);
      })
      .catch(() => setMembers([]));
    return () => {
      off = true;
    };
  }, []);
  return (
    <Shell title="Members">
      {members === null ? (
        <Skel />
      ) : members.length === 0 ? (
        <Muted>No staff members yet.</Muted>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Name", "Email", "Role", "Status"].map((h) => (
                <th
                  key={h}
                  className="px-4 pb-2.5 text-left text-[12px] font-medium tracking-[0.04em] uppercase"
                  style={{
                    color: "var(--text-muted)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.id}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td className="px-4 py-3 text-[14px] font-medium">
                  {m.displayName || "—"}
                </td>
                <td
                  className="px-4 py-3 text-[14px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {m.email}
                </td>
                <td
                  className="px-4 py-3 text-[14px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {m.primaryRole || "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusDot status={m.status?.toLowerCase() as PortalStatus} />
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
export function SettingsView({ me }: { me: EntMe | null }) {
  const cp = me?.channelPartner;
  return (
    <Shell title="Settings">
      <Section title="Organization">
        <Row k="Name" v={me?.org.name ?? "—"} />
        <Row k="Enterprise code" v={me?.org.enterpriseCode ?? "—"} mono />
        <Row
          k="Data retention"
          v={
            me
              ? me.org.retentionDays
                ? `${me.org.retentionDays} days`
                : "Indefinite"
              : "—"
          }
        />
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

      <Section title="Terms">
        <Row k="Organization agreement" v="Managed at sign-in" />
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-faint)" }}>
          The accepted version + date appear here once the org-terms gate ships.
        </p>
      </Section>

      <p className="mt-6 text-[13px]" style={{ color: "var(--text-muted)" }}>
        Theme (light / dark / espresso) lives in the rail. Editing name, domain,
        retention and notification prefs uses the existing controls.
      </p>
    </Shell>
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
