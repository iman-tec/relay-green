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
import { Button, Input, OtpDigitInput, Toast } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";

type Mode = "password" | "otp-email" | "otp-code";
type Purpose = "first-time" | "forgot";
type OAuthProvider = "github" | "google";

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
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const switchToOtp = (p: Purpose) => {
    setError(null);
    setPwd("");
    setPurpose(p);
    setMode("otp-email");
  };

  // ── OAuth (GitHub) ──────────────────────────────────────────────────
  // Redirects to the provider; on return the /auth/callback route exchanges
  // the code for a session and routes the user onward. The provider must be
  // enabled in the Supabase dashboard (Authentication → Providers).
  const handleOAuth = async (provider: OAuthProvider) => {
    setError(null);
    setOauthLoading(provider);
    try {
      const sb = createClient();
      const { error: oErr } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oErr) throw oErr;
      // On success the browser is redirected to the provider — no further
      // local state changes needed.
    } catch (err) {
      setError(friendlyError(err));
      setOauthLoading(null);
    }
  };

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
        body: JSON.stringify({ email: em, password, surface: "customer" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
        allowed_surface_url?: string;
      };
      if (!res.ok || !body.ok) {
        // Role-gate: account exists but isn't admitted on the customer
        // surface. Send them to their correct surface instead of leaking
        // the raw error code into the UI.
        if (body.error === "wrong_login_surface" && body.allowed_surface_url) {
          window.location.assign(
            `${body.allowed_surface_url}?wrong_surface=1&email=${encodeURIComponent(em)}`
          );
          return;
        }
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
        const body = (await prepareRes.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (body.error === "rate_limited") {
          setError("Too many attempts — wait a minute before trying again.");
          return;
        }
        // Note: /api/auth/prepare is enumeration-safe — it never returns
        // email_exists / email_not_found, so we must not branch on account
        // state here (doing so would re-introduce the SEC-API-ENUM-1 oracle).
        setError(
          typeof body.error === "string"
            ? body.error
            : "Could not start sign-in."
        );
        return;
      }
      const sendRes = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em }),
      });
      if (!sendRes.ok) {
        const body = (await sendRes.json().catch(() => ({}))) as {
          error?: string;
        };
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
        body: JSON.stringify({
          email,
          code: full,
          surface: "customer",
          purpose,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
        allowed_surface_url?: string;
      };
      if (!res.ok || !body.ok) {
        if (body.error === "wrong_login_surface" && body.allowed_surface_url) {
          window.location.assign(
            `${body.allowed_surface_url}?wrong_surface=1&email=${encodeURIComponent(email)}`
          );
          return;
        }
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
    const oauthBtn =
      "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-60";
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
          label={
            <span className="flex w-full items-center justify-between gap-2">
              <span>Password</span>
              <button
                type="button"
                disabled={loading}
                onClick={() => switchToOtp("forgot")}
                className="text-xs font-normal text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                Forgot password?
              </button>
            </span>
          }
          required
          requiredMark={false}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          disabled={loading}
          placeholder="Your password"
          value={password}
          onChange={(e) => setPwd(e.target.value)}
          suffix={
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)] focus-visible:outline-none"
            >
              {showPassword ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a17.42 17.42 0 0 1 4.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a17.39 17.39 0 0 1-2.16 3.19" />
                  <path d="m1 1 22 22" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          }
        />

        {error && <Toast tone="risk">{error}</Toast>}

        <Button type="submit" full loading={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>

        <div className="flex items-center gap-3 py-1" aria-hidden>
          <span className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-xs text-[var(--text-muted)]">
            or continue with
          </span>
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={loading || oauthLoading !== null}
            onClick={() => void handleOAuth("google")}
            className={oauthBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {oauthLoading === "google"
              ? "Redirecting…"
              : "Continue with Google"}
          </button>
          <button
            type="button"
            disabled={loading || oauthLoading !== null}
            onClick={() => void handleOAuth("github")}
            className={oauthBtn}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.55-.29-5.23-1.27-5.23-5.67 0-1.25.45-2.27 1.19-3.07-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.17a11 11 0 0 1 5.8 0c2.2-1.48 3.17-1.17 3.17-1.17.63 1.58.23 2.75.11 3.04.74.8 1.19 1.82 1.19 3.07 0 4.41-2.69 5.38-5.25 5.66.42.36.8 1.08.8 2.18v3.23c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
            </svg>
            {oauthLoading === "github"
              ? "Redirecting…"
              : "Continue with GitHub"}
          </button>
        </div>

        <div className="flex items-center justify-center pt-1 text-xs">
          <button
            type="button"
            onClick={() => switchToOtp("first-time")}
            className="text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
          >
            First time signing in?
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
          <h2 className="font-serif text-lg leading-tight text-[var(--text)]">
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
          className="text-center text-sm text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
        >
          ← Back to password sign in
        </button>
      </form>
    );
  }

  // ── OTP code mode ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <Toast tone="ok" title="Check your email">
        If an account exists for{" "}
        <strong className="text-[var(--text)]">{email}</strong>, we&apos;ve sent
        an 8-digit code.
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
        className="text-center text-sm text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
      >
        Use a different email
      </button>
    </div>
  );
}
