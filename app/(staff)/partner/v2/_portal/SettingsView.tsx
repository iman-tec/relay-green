"use client";

/*
 * Settings — Channel Partner. Profile (name, editable), account identity
 * (partner code + commission, read-only), payout details (editable), theme,
 * terms (the partner agreement), and the data-retention policy. Money/rate
 * fields are read-only — commission is set by Relay, passthrough is configured
 * per company at onboard.
 */

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { createClient } from "@/lib/supabase/browser";
import type { PortalPayload } from "./types";

const PARTNER_TERMS_URL = "/legal/contracting-terms";

export function SettingsView({
  data,
  email,
}: {
  data: PortalPayload | null;
  email: string;
}) {
  const r = data?.reseller;

  // Profile name (caller's own profile).
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void (async () => {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (off || !u.user) return;
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
    setSavingName(true);
    setNameMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      if (!res.ok) throw new Error("Couldn't save.");
      setNameMsg("Saved.");
    } catch (e) {
      setNameMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingName(false);
    }
  };

  // Payout email.
  const [payout, setPayout] = useState("");
  const [payoutLoaded, setPayoutLoaded] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/reseller/payout", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (off) return;
        setPayout((d?.payoutEmail as string) ?? "");
        setPayoutLoaded(true);
      })
      .catch(() => setPayoutLoaded(true));
    return () => {
      off = true;
    };
  }, []);
  const savePayout = async () => {
    setSavingPayout(true);
    setPayoutMsg(null);
    try {
      const res = await fetch("/api/reseller/payout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutEmail: payout.trim() || null }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok)
        throw new Error(
          b.error === "invalid_email"
            ? "That doesn't look like a valid email."
            : "Couldn't save."
        );
      setPayoutMsg("Saved.");
    } catch (e) {
      setPayoutMsg(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingPayout(false);
    }
  };

  const [copied, setCopied] = useState(false);

  return (
    <div className="mx-auto max-w-[680px] px-10 py-9">
      <h1
        className="mb-7 font-serif text-[22px] font-semibold"
        style={{ letterSpacing: "-0.01em" }}
      >
        Settings
      </h1>

      {/* Profile */}
      <Section title="Your profile">
        <EditRow label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={!loaded}
            className={inputCls}
            style={inputStyle}
          />
        </EditRow>
        <Row k="Email" v={email || "—"} />
        <SaveBar
          onClick={saveName}
          busy={savingName}
          disabled={!name.trim() || !loaded}
          msg={nameMsg}
        />
      </Section>

      {/* Account */}
      <Section title="Channel partner">
        <Row k="Partner name" v={r?.name ?? "—"} />
        <div
          className="flex items-center justify-between gap-4 border-b py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            Partner code
          </span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(r?.code ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1.5 font-mono text-[14px] font-medium"
            style={{ color: "var(--text)" }}
          >
            {r?.code ?? "—"}
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <Row
          k="Commission rate"
          v={r ? `${r.commission}%` : "—"}
          hint="Set by Relay in your partner agreement."
        />
        <Row
          k="Default passthrough"
          v={r ? `${r.defaultPassthroughPct}%` : "—"}
          hint="Default discount to new clients (override per onboard)."
        />
      </Section>

      {/* Payout */}
      <Section title="Payout details">
        <EditRow label="Payout email">
          <input
            value={payout}
            onChange={(e) => setPayout(e.target.value)}
            placeholder="finance@partner.com"
            type="email"
            disabled={!payoutLoaded}
            className={inputCls}
            style={inputStyle}
          />
        </EditRow>
        <SaveBar
          onClick={savePayout}
          busy={savingPayout}
          disabled={!payoutLoaded}
          msg={payoutMsg}
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

      {/* Terms */}
      <Section title="Terms">
        <Row k="Agreement" v="Channel Partner Commercial Terms" />
        <a
          href={PARTNER_TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[13px] no-underline"
          style={{ color: "var(--primary-hover)" }}
        >
          View / download ↗
        </a>
      </Section>

      {/* Data retention */}
      <Section title="Data retention">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          You see aggregate metrics only — never your clients’ individual
          members, sessions, or message content (GDPR data minimization). Each
          client organization sets its own retention window.
        </p>
      </Section>
    </div>
  );
}

const inputCls = "w-full rounded-md border px-3 py-2 text-[14px] outline-none";
const inputStyle = {
  borderColor: "var(--border-strong)",
  background: "var(--surface)",
} as const;

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

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="border-b py-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          {k}
        </span>
        <span
          className="text-[14px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {v}
        </span>
      </div>
      {hint && (
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-faint)" }}>
          {hint}
        </p>
      )}
    </div>
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
      <div className="w-[280px] max-w-[60%]">{children}</div>
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
