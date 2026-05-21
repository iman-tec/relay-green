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
 *
 * Phase-3 restyle: all endpoints + state machine preserved. Visual
 * layer rebuilt on ui/* primitives (Input, OtpDigitInput, Button,
 * Toast). Coral primary CTA, label + autoComplete on every field.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Briefcase, Eye, ShieldCheck, Building2 } from "lucide-react";
import {
  Button,
  Input,
  OtpDigitInput,
  Toast,
} from "@/app/_components/ui";

type Mode = "password" | "otp-email" | "otp-code";

type DevRole = {
  label: string;
  devRole: string;
  icon: React.ComponentType<{ size?: number }>;
  hint: string;
};

const DEV_ROLES: DevRole[] = [
  { label: "Engineer", devRole: "engineer", icon: Briefcase, hint: "Take calls and run sessions" },
  { label: "Supervisor", devRole: "supervisor", icon: Eye, hint: "Monitor live sessions" },
  { label: "Internal Admin", devRole: "internal", icon: ShieldCheck, hint: "Platform configuration" },
  { label: "Enterprise Admin", devRole: "enterprise", icon: Building2, hint: "Org-level controls" },
];

const RESET_COPY = {
  title: "Reset your password",
  blurb:
    "Enter your work email and we'll send you an 8-digit code. After verifying you can choose a new password.",
  cta: "Email me a reset code",
} as const;

export function StaffLoginForm({ devMode }: { devMode: boolean }) {
  const search = useSearchParams();
  const initialEmail = search?.get("email") ?? "";

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "password" && initialEmail) {
      passwordRef.current?.focus();
    }
  }, [mode, initialEmail]);

  // Staff "Forgot password?" is the only OTP path — purpose=forgot rejects
  // unknown emails (so a typo doesn't silently create a self-signup row)
  // and verify-otp diverts to /set-password unconditionally so the user
  // can pick a new password.
  const sendCode = async (target: string): Promise<boolean> => {
    const prepRes = await fetch("/api/auth/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: target, purpose: "forgot" }),
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: target }),
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password, mode: "staff" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
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
  const verifyCode = async (full: string) => {
    if (full.length !== 8) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: full, mode: "staff", purpose: "forgot" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
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

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void verifyCode(code.trim());
  };

  // ── OTP code mode UI ───────────────────────────────────────────────
  if (mode === "otp-code") {
    return (
      <div className="flex flex-col gap-4">
        <Toast tone="ok" title="Code sent">
          We sent an 8-digit code to <strong className="text-[var(--text)]">{email}</strong>.
        </Toast>

        <form onSubmit={handleVerifySubmit} className="flex flex-col gap-4">
          <OtpDigitInput
            length={8}
            value={code}
            onChange={setCode}
            onComplete={verifyCode}
            label="8-digit code"
            disabled={loading}
            autoFocus
            error={error ?? undefined}
            hint={info ?? "Check your inbox. The code expires in 10 minutes."}
          />

          <Button
            type="submit"
            full
            loading={loading}
            disabled={code.length !== 8}
          >
            {loading ? "Verifying…" : "Sign in"}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)] disabled:opacity-50"
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
            className="text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)]"
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
          <h2 className="font-serif text-lg text-[var(--text)] leading-tight">
            {RESET_COPY.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
            {RESET_COPY.blurb}
          </p>
        </div>

        <form onSubmit={handleSendCode} className="flex flex-col gap-4">
          <Input
            label="Work email"
            type="email"
            autoComplete="email"
            required
            disabled={loading}
            autoFocus
            placeholder="you@relay.green"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <Toast tone="risk">{error}</Toast>}

          <Button
            type="submit"
            full
            loading={loading}
            disabled={!email.trim()}
          >
            {loading ? "Sending code…" : RESET_COPY.cta}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("password");
            setTimeout(() => passwordRef.current?.focus(), 80);
          }}
          className="text-center text-sm text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)]"
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
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          required
          disabled={loading}
          autoFocus={!initialEmail}
          placeholder="you@relay.green"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          ref={passwordRef}
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          disabled={loading}
          placeholder="Your password"
          value={password}
          onChange={(e) => setPwd(e.target.value)}
        />

        {error && <Toast tone="risk">{error}</Toast>}

        <Button
          type="submit"
          full
          loading={loading}
          disabled={!email.trim() || !password}
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center justify-between gap-3 text-xs">
        <p className="text-[var(--text-muted)]">
          New here? Check your invite email.
        </p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPwd("");
            setMode("otp-email");
          }}
          className="text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)]"
        >
          Forgot password?
        </button>
      </div>

      {devMode && <DevModePanel />}
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────── */

function DevModePanel() {
  return (
    <details className="group mt-2 rounded-lg border border-[var(--border)]">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] select-none">
        <span>Developer shortcuts</span>
        <span className="transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>
      <div className="border-t border-[var(--border)] p-3">
        <p className="mb-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
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
                className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_2%,transparent)] px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--primary-soft)] text-[var(--primary)]">
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[var(--text)]">
                    {r.label}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {r.hint}
                  </div>
                </div>
                <span className="text-[var(--text-muted)]">→</span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
