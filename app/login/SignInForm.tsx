"use client";

import { useState, useRef } from "react";

// Note: this component talks to our own Next.js API routes for OTP send +
// verify (not Supabase directly from the browser). Some networks /
// extensions block the browser-to-Supabase fetch, so we proxy everything
// through the dev server, which always has connectivity to Supabase.

type Step = "email" | "code" | "done";

export function SignInForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Converts raw errors into friendly one-liners shown in the UI.
  // Covers: missing env-config, "Failed to fetch" network blips, and
  // Supabase error objects.
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

  // Step 1 — send OTP code to email
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);

    try {
      // Pre-create the user server-side so Supabase treats this as a
      // sign-in (Magic Link template = OTP code) instead of a sign-up
      // (Confirm Signup template = magic link URL).
      const prepareRes = await fetch("/api/auth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!prepareRes.ok) {
        const body = await prepareRes.json().catch(() => ({})) as Record<string, unknown>;
        if (body.error === "rate_limited") {
          setError("Too many attempts — wait a minute before trying again.");
          return;
        }
        // Other prepare errors are non-fatal: fall through and let
        // signInWithOtp decide (worst case the wrong email template fires).
      }

      // Send the OTP server-side. Avoids the browser-to-Supabase fetch which
      // fails on some networks ("TypeError: Failed to fetch").
      const sendRes = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!sendRes.ok) {
        const body = await sendRes.json().catch(() => ({})) as { error?: string };
        setError(friendlyError(body.error ?? "Could not send code."));
        return;
      }
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (err) {
      // Catches: network failures hitting our own API.
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — verify the 8-digit code (server-side, so the browser never
  // touches Supabase directly).
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 8) return;
    setLoading(true);
    setError(null);

    try {
      const verifyRes = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // mode: "customer" → server skips role-based routing so users who
        // also hold a staff role still land on /room when signing in here.
        body: JSON.stringify({ email, code: trimmed, mode: "customer" }),
      });
      const body = await verifyRes.json().catch(() => ({})) as { error?: string; next?: string };
      if (!verifyRes.ok) {
        setError(friendlyError(body.error ?? "Couldn't verify code."));
        return;
      }
      // Server set the auth cookies — a full navigation picks them up
      // cleanly (router.push can race the cookie flush in some setups).
      // The /next path is role-aware: staff land on their dashboard,
      // customers on /room.
      window.location.assign(body.next ?? "/room");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Email ─────────────────────────────────────────────────────────
  if (step === "email") {
    return (
      <form onSubmit={handleSendCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="w-full rounded-md border px-3.5 py-2.5 text-sm outline-none transition-colors"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
            onFocus={(e) => (e.target.style.borderColor = "#3f5c2e")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        {error && <ErrorBanner message={error} />}

        <GreenButton loading={loading} label="Send code" loadingLabel="Sending…" />

        <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
          We&apos;ll email you the code. No password needed.
        </p>

        <button
          type="button"
          onClick={() => {
            const trimmed = email.trim();
            if (!trimmed) {
              setError("Enter your email first.");
              return;
            }
            setError(null);
            setStep("code");
            setTimeout(() => codeRef.current?.focus(), 80);
          }}
          className="text-center text-xs underline-offset-4 hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          Already have a code?
        </button>
      </form>
    );
  }

  // ── Step 2: OTP Code ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      {/* Sent confirmation */}
      <div
        className="flex items-start gap-3 rounded-md border px-4 py-3"
        style={{ borderColor: "color-mix(in srgb, #3f5c2e 30%, transparent)", backgroundColor: "color-mix(in srgb, #3f5c2e 7%, transparent)" }}
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
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
            onFocus={(e) => (e.target.style.borderColor = "#3f5c2e")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        {error && <ErrorBanner message={error} />}

        <GreenButton loading={loading} label="Sign in" loadingLabel="Verifying…" disabled={code.length !== 8} />
      </form>

      <button
        onClick={() => { setStep("email"); setCode(""); setError(null); }}
        className="text-center text-sm underline-offset-4 hover:underline"
        style={{ color: "var(--text-muted)" }}
      >
        Use a different email
      </button>
    </div>
  );
}

function GreenButton({
  loading,
  label,
  loadingLabel,
  disabled,
}: {
  loading: boolean;
  label: string;
  loadingLabel: string;
  disabled?: boolean;
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
