"use client";

/*
 * Staff sign-in — engineer / supervisor / internal admin / enterprise admin.
 *
 * Two modes:
 *   1. Email + OTP code (real Supabase auth, same flow as customer login).
 *      Role is detected server-side after sign-in and the user is redirected
 *      to the matching dashboard.
 *
 *   2. Dev quick-pick — a row of role buttons that skip auth and route
 *      straight to the role's dashboard. Useful for static layout review
 *      until the role-detection backend is fully wired.
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Eye, ShieldCheck, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Step = "email" | "code";

const BRAND_GREEN = "#3f5c2e";

const ROLES = [
  { label: "Engineer",         devRole: "engineer",   icon: Briefcase,   hint: "Take calls and run sessions" },
  { label: "Supervisor",       devRole: "supervisor", icon: Eye,         hint: "Monitor live sessions" },
  { label: "Internal Admin",   devRole: "internal",   icon: ShieldCheck, hint: "Platform configuration" },
  { label: "Enterprise Admin", devRole: "enterprise", icon: Building2,   hint: "Org-level controls" },
];

export function StaffLoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);

    // Pre-create user server-side so Supabase uses Magic Link template
    // (configured for OTP code) instead of Confirm Signup template.
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

    setLoading(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setStep("code");
    setTimeout(() => codeRef.current?.focus(), 80);
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 8) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: trimmed,
      type: "email",
    });

    setLoading(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    // TODO: detect role server-side and redirect accordingly. For now route
    // to /dashboard which is the engineer/supervisor default landing.
    router.push("/dashboard");
  };

  // ── Step 1: Email + Dev quick-pick ────────────────────────────────────────
  if (step === "email") {
    return (
      <div className="flex flex-col gap-6">
        {/* Email form */}
        <form onSubmit={handleSendCode} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              placeholder="you@relay.green"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full rounded-md border px-3.5 py-2.5 text-sm outline-none transition-colors"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
              onFocus={(e) => (e.target.style.borderColor = BRAND_GREEN)}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />
          </div>

          {error && <ErrorBanner message={error} />}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {loading ? "Sending…" : "Send code"}
          </button>

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

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            Dev · Quick pick
          </span>
          <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
        </div>

        {/* Role buttons */}
        <div className="grid gap-2">
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.devRole}
                type="button"
                onClick={() => {
                  // One-click bypass: full server-side sign-in as the demo
                  // account for this role, then redirects to its dashboard.
                  window.location.href = `/api/dev/sign-in-as?role=${r.devRole}`;
                }}
                className="flex items-center gap-3 rounded-md border px-3.5 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "color-mix(in srgb, var(--text) 2%, transparent)",
                }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 12%, transparent)", color: BRAND_GREEN }}
                >
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
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
    );
  }

  // ── Step 2: OTP Code ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex items-start gap-3 rounded-md border px-4 py-3"
        style={{
          borderColor: "color-mix(in srgb, " + BRAND_GREEN + " 30%, transparent)",
          backgroundColor: "color-mix(in srgb, " + BRAND_GREEN + " 7%, transparent)",
        }}
      >
        <span style={{ color: BRAND_GREEN, marginTop: 1 }}>
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
            onFocus={(e) => (e.target.style.borderColor = BRAND_GREEN)}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        {error && <ErrorBanner message={error} />}

        <button
          type="submit"
          disabled={loading || code.length !== 8}
          className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {loading ? "Verifying…" : "Sign in"}
        </button>
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
