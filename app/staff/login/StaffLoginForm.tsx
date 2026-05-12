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
import { Briefcase, Eye, ShieldCheck, Building2 } from "lucide-react";

// Talks to our own /api/auth/{send,verify}-otp routes (server-side Supabase)
// rather than the browser client — some networks block direct browser-to-
// Supabase fetches. The verify route also clears any pre-existing session
// before issuing a new one, so a leftover dev quick-pick login can't bleed
// into the next user's session.

type Step = "email" | "code";

// The four claimable roles on the OTP form. `dbRole` is the value persisted
// into the `user_roles` table; `devRole` is the demo-account key used by the
// dev quick-pick buttons below. Keeping both in one list so the labels stay
// in sync.
type StaffRole = {
  label:   string;
  dbRole:  "engineer" | "pod_lead" | "ops_manager" | "admin";
  devRole: string;
  icon:    React.ComponentType<{ size?: number }>;
  hint:    string;
};

const BRAND_GREEN = "#3f5c2e";

const ROLES: StaffRole[] = [
  { label: "Engineer",         dbRole: "engineer",     devRole: "engineer",   icon: Briefcase,   hint: "Take calls and run sessions" },
  { label: "Supervisor",       dbRole: "pod_lead",     devRole: "supervisor", icon: Eye,         hint: "Monitor live sessions" },
  { label: "Internal Admin",   dbRole: "ops_manager",  devRole: "internal",   icon: ShieldCheck, hint: "Platform configuration" },
  { label: "Enterprise Admin", dbRole: "admin",        devRole: "enterprise", icon: Building2,   hint: "Org-level controls" },
];

export function StaffLoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which role to grant on first sign-in. Defaults to Engineer because that's
  // the most common staff sign-in we see in dev.
  const [selectedRole, setSelectedRole] = useState<StaffRole["dbRole"]>("engineer");
  const codeRef = useRef<HTMLInputElement>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);

    try {
      // Pre-create user server-side so Supabase uses Magic Link template
      // (configured for OTP code) instead of Confirm Signup template.
      await fetch("/api/auth/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });

      const sendRes = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!sendRes.ok) {
        const body = await sendRes.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Could not send code.");
        return;
      }
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

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
        // mode: "staff" → server resolves landing by role (engineer →
        // /dashboard, pod_lead → /supervise, etc.). role is also granted
        // server-side if the user doesn't already have it.
        body: JSON.stringify({ email, code: trimmed, role: selectedRole, mode: "staff" }),
      });
      const body = await verifyRes.json().catch(() => ({})) as { error?: string; next?: string };
      if (!verifyRes.ok) {
        setError(body.error ?? "Couldn't verify code.");
        return;
      }
      // The verify route inspects user_roles and tells us where this user
      // belongs (engineer → /dashboard, pod_lead → /supervise, admin/ops_manager
      // → /admin, plain customer → /room). Full navigation so the proxy
      // reads the freshly-written auth cookies on the next request.
      window.location.assign(body.next ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify code.");
    } finally {
      setLoading(false);
    }
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

          {/* Sign in as — what role to grant on first sign-in. If the user
              already has a role, this is a no-op (RPC is idempotent). */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Sign in as
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {ROLES.map((r) => {
                const Icon   = r.icon;
                const active = selectedRole === r.dbRole;
                return (
                  <button
                    key={r.dbRole}
                    type="button"
                    onClick={() => setSelectedRole(r.dbRole)}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors"
                    style={{
                      borderColor:     active ? BRAND_GREEN : "var(--border)",
                      backgroundColor: active
                        ? "color-mix(in srgb, " + BRAND_GREEN + " 10%, transparent)"
                        : "var(--surface)",
                      color: active ? BRAND_GREEN : "var(--text)",
                    }}
                  >
                    <Icon size={13} />
                    <span className="truncate">{r.label}</span>
                  </button>
                );
              })}
            </div>
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
