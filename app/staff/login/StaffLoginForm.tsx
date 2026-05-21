"use client";

/*
 * Staff sign-in — email + password is the only entry point. Staff are
 * invite-only: a new user clicks the link in their invite email, which
 * lands them on /set-password (via /auth/callback) to choose a
 * password, then on their role's dashboard. From then on they sign in
 * here with email + password.
 *
 * Forgot password is the universal recovery — it sends an 8-digit OTP
 * to the email; verify-otp then routes through /set-password so the
 * user can pick a new password.
 *
 * Dev mode shortcuts (NODE_ENV=development only) stay unchanged — they
 * bypass auth entirely and sign in as seeded demo accounts.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Briefcase, Eye, ShieldCheck, Building2 } from "lucide-react";

type Mode = "password" | "otp-email" | "otp-code";

type DevRole = {
  label:    string;
  devRole:  string;
  icon:     React.ComponentType<{ size?: number }>;
  hint:     string;
};

const BRAND_GREEN = "#3f5c2e";

const DEV_ROLES: DevRole[] = [
  { label: "Engineer",         devRole: "engineer",   icon: Briefcase,   hint: "Take calls and run sessions" },
  { label: "Supervisor",       devRole: "supervisor", icon: Eye,         hint: "Monitor live sessions" },
  { label: "Internal Admin",   devRole: "internal",   icon: ShieldCheck, hint: "Platform configuration" },
  { label: "Enterprise Admin", devRole: "enterprise", icon: Building2,   hint: "Org-level controls" },
];

export function StaffLoginForm({ devMode }: { devMode: boolean }) {
  const search = useSearchParams();
  const initialEmail = search?.get("email") ?? "";

  const [mode, setMode]           = useState<Mode>("password");
  const [email, setEmail]         = useState(initialEmail);
  const [password, setPwd]        = useState("");
  const [code, setCode]           = useState("");
  const [loading, setLoading]     = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [info, setInfo]           = useState<string | null>(null);
  const codeRef     = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const resetCopy = {
    title:  "Reset your password",
    blurb:  "Enter your work email and we'll send you an 8-digit code. After verifying you can choose a new password.",
    cta:    "Email me a reset code",
  } as const;

  // Focus password input when mounting in password mode so the form is
  // immediately keyboard-actionable for returning staff.
  useEffect(() => {
    if (mode === "password" && initialEmail) {
      passwordRef.current?.focus();
    }
  }, [mode, initialEmail]);

  // ── Helpers ────────────────────────────────────────────────────────
  // Staff "Forgot password?" is the only OTP path — purpose=forgot rejects
  // unknown emails (so a typo doesn't silently create a self-signup row)
  // and verify-otp diverts to /set-password unconditionally so the user
  // can pick a new password.
  const sendCode = async (target: string): Promise<boolean> => {
    const prepRes = await fetch("/api/auth/prepare", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: target, purpose: "forgot" }),
    });
    if (!prepRes.ok) {
      const body = (await prepRes.json().catch(() => ({}))) as { error?: string };
      if (body.error === "email_not_found") {
        setError("No account found for that email — ask your admin to invite you.");
        return false;
      }
      if (body.error === "rate_limited") {
        setError("Too many attempts — wait a minute before trying again.");
        return false;
      }
    }
    const sendRes = await fetch("/api/auth/send-otp", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: target }),
    });
    if (!sendRes.ok) {
      const body = (await sendRes.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not send code.");
      return false;
    }
    return true;
  };

  // ── Password sign-in ───────────────────────────────────────────────
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !password) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/signin-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: em, password, mode: "staff" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?:    boolean;
        next?:  string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Couldn't sign in.");
        return;
      }
      window.location.assign(body.next ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setLoading(false);
    }
  };

  // ── OTP send ───────────────────────────────────────────────────────
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const ok = await sendCode(em);
      if (!ok) return;
      setMode("otp-code");
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const em = email.trim().toLowerCase();
    if (!em) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const ok = await sendCode(em);
      if (ok) setInfo("New code sent. Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setResending(false);
    }
  };

  // ── OTP verify ─────────────────────────────────────────────────────
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 8) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, code: trimmed, mode: "staff", purpose: "forgot" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; next?: string; error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Couldn't verify code.");
        return;
      }
      window.location.assign(body.next ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify code.");
    } finally {
      setLoading(false);
    }
  };

  // ── OTP code mode UI ───────────────────────────────────────────────
  if (mode === "otp-code") {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="flex items-start gap-3 rounded-md border px-4 py-3"
          style={{
            borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 30%, transparent)",
            backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 7%, transparent)",
          }}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke={BRAND_GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" style={{ marginTop: 2 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
            We sent an 8-digit code to{" "}
            <span style={{ fontWeight: 500 }}>{email}</span>
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-sm font-medium" style={{ color: "var(--text)" }}>
              8-digit code
            </label>
            <input
              id="code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              required
              placeholder="••••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              disabled={loading}
              className="w-full rounded-md border px-3.5 py-3 text-center text-xl tracking-[0.4em] outline-none transition-colors"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
              }}
              onFocus={(e) => (e.target.style.borderColor = BRAND_GREEN)}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />
          </div>

          {error && <ErrorBanner message={error} />}
          {info  && <InfoBanner  message={info}  />}

          <button
            type="submit"
            disabled={loading || code.length !== 8}
            className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {loading ? "Verifying…" : "Sign in"}
          </button>
        </form>

        <div className="flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="underline-offset-4 hover:underline disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            {resending ? "Resending…" : "Didn't get it? Resend code"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setCode("");
              setError(null);
              setInfo(null);
            }}
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            ← Use password instead
          </button>
        </div>
      </div>
    );
  }

  // ── OTP email mode UI (forgot-password only) ───────────────────────
  if (mode === "otp-email") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {resetCopy.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {resetCopy.blurb}
          </p>
        </div>

        <form onSubmit={handleSendCode} className="flex flex-col gap-3">
          <FieldEmail email={email} onChange={setEmail} disabled={loading} autoFocus />

          {error && <ErrorBanner message={error} />}

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {loading ? "Sending code…" : resetCopy.cta}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("password");
            setTimeout(() => passwordRef.current?.focus(), 80);
          }}
          className="text-center text-xs underline-offset-4 hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          ← Back to password sign in
        </button>

        {devMode && <DevModePanel />}
      </div>
    );
  }

  // ── Password mode UI (default) ─────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
        <FieldEmail email={email} onChange={setEmail} disabled={loading} autoFocus={!initialEmail} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Password
          </label>
          <input
            id="password"
            ref={passwordRef}
            type="password"
            required
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPwd(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border px-3.5 py-2.5 text-sm outline-none transition-colors"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text)",
            }}
            onFocus={(e) => (e.target.style.borderColor = BRAND_GREEN)}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        {error && <ErrorBanner message={error} />}

        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="flex items-center justify-between gap-3 text-xs">
        <p style={{ color: "var(--text-muted)" }}>
          New here? Check your invite email.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPwd("");
            setMode("otp-email");
          }}
          className="underline-offset-4 hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          Forgot password?
        </button>
      </div>

      {devMode && <DevModePanel />}
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────── */

function FieldEmail({
  email,
  onChange,
  disabled,
  autoFocus,
}: {
  email:     string;
  onChange:  (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="email" className="text-sm font-medium" style={{ color: "var(--text)" }}>
        Work email
      </label>
      <input
        id="email"
        type="email"
        required
        autoFocus={autoFocus}
        autoComplete="email"
        placeholder="you@relay.green"
        value={email}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border px-3.5 py-2.5 text-sm outline-none transition-colors"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          color: "var(--text)",
        }}
        onFocus={(e) => (e.target.style.borderColor = BRAND_GREEN)}
        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
      />
    </div>
  );
}

function DevModePanel() {
  return (
    <details
      className="group mt-2 rounded-md border"
      style={{ borderColor: "var(--border)" }}
    >
      <summary
        className="flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase select-none"
        style={{ color: "var(--text-muted)" }}
      >
        <span>Developer shortcuts</span>
        <span className="transition-transform group-open:rotate-90" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
        <p className="mb-2.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Skips auth. Signs in as a seeded demo account. Dev only.
        </p>
        <div className="grid gap-1.5">
          {DEV_ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.devRole}
                type="button"
                onClick={() => {
                  window.location.href = `/api/dev/sign-in-as?role=${r.devRole}`;
                }}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "color-mix(in srgb, var(--text) 2%, transparent)",
                }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 12%, transparent)",
                    color: BRAND_GREEN,
                  }}
                >
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {r.label}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {r.hint}
                  </div>
                </div>
                <span style={{ color: "var(--text-muted)" }}>→</span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      className="rounded-md px-3 py-2 text-sm"
      style={{
        backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
        color: "var(--accent-red)",
        border: "1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)",
      }}
    >
      {message}
    </p>
  );
}

function InfoBanner({ message }: { message: string }) {
  return (
    <p
      className="rounded-md px-3 py-2 text-sm"
      style={{
        backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 8%, transparent)",
        color: BRAND_GREEN,
        border: "1px solid color-mix(in srgb, " + BRAND_GREEN + " 25%, transparent)",
      }}
    >
      {message}
    </p>
  );
}
