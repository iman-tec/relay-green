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
 * The plain password sign-in path is unchanged. Why server-side fetches
 * everywhere: corporate networks / extensions sometimes block
 * browser→Supabase — the Node API routes always have connectivity.
 */

import { useRef, useState } from "react";

type Mode    = "password" | "otp-email" | "otp-code";
type Purpose = "first-time" | "forgot";

export function SignInForm() {
  const [mode, setMode]       = useState<Mode>("password");
  const [purpose, setPurpose] = useState<Purpose>("first-time");
  const [email, setEmail]     = useState("");
  const [password, setPwd]    = useState("");
  const [code, setCode]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const codeRef     = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const purposeCopy = {
    "first-time": {
      title:    "First-time sign-up",
      blurb:    "Enter your email and we'll send you an 8-digit code. After verifying you'll choose a password.",
      cta:      "Send sign-up code",
      ctaSent:  "Sending…",
    },
    "forgot": {
      title:    "Reset your password",
      blurb:    "Enter the email on your account and we'll send you an 8-digit code. After verifying you can choose a new password.",
      cta:      "Send reset code",
      ctaSent:  "Sending…",
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

  // ── Password sign-in ────────────────────────────────────────────────
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signin-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: em, password, mode: "customer" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; next?: string; error?: string;
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
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: em, purpose }),
      });
      if (!prepareRes.ok) {
        const body = (await prepareRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (body.error === "rate_limited") {
          setError("Too many attempts — wait a minute before trying again.");
          return;
        }
        if (body.error === "email_exists") {
          setError("That email is already registered. Use \"Forgot password?\" instead.");
          return;
        }
        if (body.error === "email_not_found") {
          setError("No account found for that email. Use \"First time signing in?\" instead.");
          return;
        }
        setError(typeof body.error === "string" ? body.error : "Could not start sign-in.");
        return;
      }
      const sendRes = await fetch("/api/auth/send-otp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: em }),
      });
      if (!sendRes.ok) {
        const body = (await sendRes.json().catch(() => ({}))) as { error?: string };
        setError(friendlyError(body.error ?? "Could not send code."));
        return;
      }
      setMode("otp-code");
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── OTP verify ──────────────────────────────────────────────────────
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 8) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, code: trimmed, mode: "customer", purpose }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; next?: string; error?: string;
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

  // ── Password mode UI ───────────────────────────────────────────────
  if (mode === "password") {
    return (
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <FieldEmail
          email={email}
          onChange={setEmail}
          disabled={loading}
          autoFocus
        />
        <FieldPassword
          inputRef={passwordRef}
          value={password}
          onChange={setPwd}
          disabled={loading}
        />

        {error ? <ErrorBanner message={error} /> : null}

        <GreenButton loading={loading} label="Sign in" loadingLabel="Signing in…" />

        <div className="flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPwd("");
              setPurpose("first-time");
              setMode("otp-email");
            }}
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
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
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            Forgot password?
          </button>
        </div>
      </form>
    );
  }

  // ── OTP email mode ─────────────────────────────────────────────────
  if (mode === "otp-email") {
    const copy = purposeCopy[purpose];
    return (
      <form onSubmit={handleSendCode} className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {copy.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {copy.blurb}
          </p>
        </div>

        <FieldEmail
          email={email}
          onChange={setEmail}
          disabled={loading}
          autoFocus
        />

        {error ? <ErrorBanner message={error} /> : null}

        <GreenButton loading={loading} label={copy.cta} loadingLabel={copy.ctaSent} />

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
      </form>
    );
  }

  // ── OTP code mode ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex items-start gap-3 rounded-md border px-4 py-3"
        style={{
          borderColor: "color-mix(in srgb, #3f5c2e 30%, transparent)",
          backgroundColor: "color-mix(in srgb, #3f5c2e 7%, transparent)",
        }}
      >
        <span style={{ color: "#3f5c2e", marginTop: 1 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
          Code sent to <span style={{ fontWeight: 500 }}>{email}</span>
        </p>
      </div>

      <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Code
          </label>
          <input
            id="code"
            ref={codeRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]{8}"
            maxLength={8}
            required
            placeholder="12345678"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            disabled={loading}
            className="w-full rounded-md border px-3.5 py-3 text-center text-xl tracking-[0.3em] outline-none transition-colors"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#3f5c2e")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        <GreenButton
          loading={loading}
          label="Verify"
          loadingLabel="Verifying…"
          disabled={code.length !== 8}
        />
      </form>

      <button
        onClick={() => {
          setMode("otp-email");
          setCode("");
          setError(null);
        }}
        className="text-center text-sm underline-offset-4 hover:underline"
        style={{ color: "var(--text-muted)" }}
      >
        Use a different email
      </button>
    </div>
  );
}

/* ── Field components (reused across modes) ─────────────────────────── */

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
      <label
        htmlFor="email"
        className="text-sm font-medium"
        style={{ color: "var(--text)" }}
      >
        Email address
      </label>
      <input
        id="email"
        type="email"
        required
        autoFocus={autoFocus}
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border px-3.5 py-2.5 text-sm outline-none transition-colors"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          color: "var(--text)",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#3f5c2e")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
      />
    </div>
  );
}

function FieldPassword({
  inputRef,
  value,
  onChange,
  disabled,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value:    string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="password"
        className="text-sm font-medium"
        style={{ color: "var(--text)" }}
      >
        Password
      </label>
      <input
        id="password"
        ref={inputRef}
        type="password"
        required
        autoComplete="current-password"
        placeholder="Your password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border px-3.5 py-2.5 text-sm outline-none transition-colors"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          color: "var(--text)",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#3f5c2e")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
      />
    </div>
  );
}

function GreenButton({
  loading,
  label,
  loadingLabel,
  disabled,
}: {
  loading:      boolean;
  label:        string;
  loadingLabel: string;
  disabled?:    boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
      style={{ backgroundColor: "#3f5c2e", color: "#ffffff" }}
    >
      {loading ? loadingLabel : label}
    </button>
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
