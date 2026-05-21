"use client";

/*
 * Customer sign-in — email + password as the default, with two distinct
 * OTP-based side-flows behind separate CTAs:
 *
 *   purpose === "first-time" → for users who've never signed in. The
 *     prepare endpoint REJECTS the request if the email already exists,
 *     so the user can't accidentally clobber an existing account.
 *   purpose === "forgot"     → for users who lost their password. The
 *     prepare endpoint REJECTS the request if the email is unknown
 *     (so we don't silently create a new account). verify-otp then
 *     ALWAYS diverts to /set-password regardless of the password_set
 *     flag, since the point is to replace the existing password.
 *
 * Phase-3 restyle: same endpoints, same mode/purpose state machine,
 * same window.location handoff on success. Visual layer rebuilt on
 * the ui/* primitives — real labels, 8-digit OtpDigitInput, role=alert
 * error toasts, coral primary CTA.
 */

import { useRef, useState } from "react";
import {
  Button,
  Input,
  OtpDigitInput,
  Toast,
} from "@/app/_components/ui";

type Mode = "password" | "otp-email" | "otp-code";
type Purpose = "first-time" | "forgot";

const PURPOSE_COPY = {
  "first-time": {
    title: "First-time sign-up",
    blurb:
      "Enter your email and we'll send you an 8-digit code. After verifying you'll choose a password.",
    cta: "Send sign-up code",
    ctaSent: "Sending…",
  },
  forgot: {
    title: "Reset your password",
    blurb:
      "Enter the email on your account and we'll send you an 8-digit code. After verifying you can choose a new password.",
    cta: "Send reset code",
    ctaSent: "Sending…",
  },
} as const;

function friendlyError(err: unknown): string {
  if (!err) return "Something went wrong. Try again.";
  const msg = err instanceof Error ? err.message : String(err);
  if (
    err instanceof TypeError ||
    msg.toLowerCase().includes("failed to fetch") ||
    msg.toLowerCase().includes("networkerror") ||
    msg.toLowerCase().includes("load failed")
  ) {
    return "Can't reach Relay servers — check your connection and try again.";
  }
  return msg || "Something went wrong. Try again.";
}

export function SignInForm() {
  const [mode, setMode] = useState<Mode>("password");
  const [purpose, setPurpose] = useState<Purpose>("first-time");
  const [email, setEmail] = useState("");
  const [password, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // ── Password sign-in ────────────────────────────────────────────────
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signin-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password, mode: "customer" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setError(friendlyError(body.error ?? "Couldn't sign in."));
        return;
      }
      window.location.assign(body.next ?? "/room");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── OTP send ────────────────────────────────────────────────────────
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    setLoading(true);
    setError(null);
    try {
      const prepareRes = await fetch("/api/auth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, purpose }),
      });
      if (!prepareRes.ok) {
        const body = (await prepareRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (body.error === "rate_limited") {
          setError("Too many attempts — wait a minute before trying again.");
          return;
        }
        if (body.error === "email_exists") {
          setError('That email is already registered. Use "Forgot password?" instead.');
          return;
        }
        if (body.error === "email_not_found") {
          setError('No account found for that email. Use "First time signing in?" instead.');
          return;
        }
        setError(typeof body.error === "string" ? body.error : "Could not start sign-in.");
        return;
      }
      const sendRes = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      if (!sendRes.ok) {
        const body = (await sendRes.json().catch(() => ({}))) as { error?: string };
        setError(friendlyError(body.error ?? "Could not send code."));
        return;
      }
      setMode("otp-code");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── OTP verify ──────────────────────────────────────────────────────
  const verifyCode = async (full: string) => {
    if (full.length !== 8) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: full, mode: "customer", purpose }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setError(friendlyError(body.error ?? "Couldn't verify code."));
        return;
      }
      window.location.assign(body.next ?? "/room");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void verifyCode(code.trim());
  };

  // ── Password mode UI ───────────────────────────────────────────────
  if (mode === "password") {
    return (
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          disabled={loading}
          autoFocus
          placeholder="you@company.com"
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

        <Button type="submit" full loading={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>

        <div className="flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPwd("");
              setPurpose("first-time");
              setMode("otp-email");
            }}
            className="text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)]"
          >
            First time signing in?
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPwd("");
              setPurpose("forgot");
              setMode("otp-email");
            }}
            className="text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)]"
          >
            Forgot password?
          </button>
        </div>
      </form>
    );
  }

  // ── OTP email mode ─────────────────────────────────────────────────
  if (mode === "otp-email") {
    const copy = PURPOSE_COPY[purpose];
    return (
      <form onSubmit={handleSendCode} className="flex flex-col gap-4">
        <div>
          <h2 className="font-serif text-lg text-[var(--text)] leading-tight">
            {copy.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
            {copy.blurb}
          </p>
        </div>

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          disabled={loading}
          autoFocus
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {error && <Toast tone="risk">{error}</Toast>}

        <Button type="submit" full loading={loading}>
          {loading ? copy.ctaSent : copy.cta}
        </Button>

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
      </form>
    );
  }

  // ── OTP code mode ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <Toast tone="ok" title="Code sent">
        We sent an 8-digit code to <strong className="text-[var(--text)]">{email}</strong>.
      </Toast>

      <form onSubmit={handleVerifySubmit} className="flex flex-col gap-4">
        <OtpDigitInput
          length={8}
          value={code}
          onChange={setCode}
          onComplete={verifyCode}
          label="Verification code"
          hint="Check your inbox. The code expires in 10 minutes."
          disabled={loading}
          autoFocus
          error={error ?? undefined}
        />

        <Button
          type="submit"
          full
          loading={loading}
          disabled={code.length !== 8}
        >
          {loading ? "Verifying…" : "Verify"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode("otp-email");
          setCode("");
          setError(null);
        }}
        className="text-center text-sm text-[var(--text-muted)] underline-offset-4 hover:underline hover:text-[var(--text)]"
      >
        Use a different email
      </button>
    </div>
  );
}
