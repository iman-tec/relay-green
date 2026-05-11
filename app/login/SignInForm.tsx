"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Step = "email" | "code" | "done";

export function SignInForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

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
      await fetch("/api/auth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: false }, // user pre-created above
      });

      if (otpError) {
        setError(otpError.message);
        return;
      }
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (err) {
      // Network errors (offline, ERR_NETWORK_CHANGED, CORS) land here.
      setError(
        err instanceof TypeError
          ? "Network error — check your connection and try again."
          : err instanceof Error
          ? err.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — verify the 8-digit code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 8) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: trimmed,
        type: "email",
      });

      if (verifyError) {
        setError(verifyError.message);
        return;
      }
      router.push("/room");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Network error — check your connection and try again."
          : err instanceof Error
          ? err.message
          : "Something went wrong. Try again.",
      );
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
