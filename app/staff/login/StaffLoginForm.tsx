"use client";

/*
 * Staff sign-in — Email + one-time code via email.
 *
 * Two-step OTP flow (same as customer /login, just with mode="staff" so
 * the server routes the user to their role's landing):
 *   1. Enter email → server sends an 8-digit code via Supabase Auth.
 *   2. Enter the code → server verifies + sets session → forward.
 *
 * On the first sign-in after admin invites a user, they typically arrive
 * via the magic-link in the invitation email (handled by /auth/callback)
 * and never see this form. They only land here for subsequent sign-ins.
 *
 * Dev quick-pick (NODE_ENV=development only) keeps a one-click route to
 * each seeded demo account.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Briefcase, Eye, ShieldCheck, Building2 } from "lucide-react";

type Step = "email" | "code";

type DevRole = {
  label: string;
  devRole: string;
  icon: React.ComponentType<{ size?: number }>;
  hint: string;
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

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const sendCode = async (target: string): Promise<boolean> => {
    await fetch("/api/auth/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: target }),
    });
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

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const ok = await sendCode(trimmed);
      if (!ok) return;
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const ok = await sendCode(trimmed);
      if (ok) setInfo("New code sent. Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    } finally {
      setResending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 8) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: trimmed, mode: "staff" }),
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

  if (step === "code") {
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
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={BRAND_GREEN}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ marginTop: 2 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
            We sent an 8-digit code to <span style={{ fontWeight: 500 }}>{email}</span>
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="code"
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
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
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
              }
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
          {info && <InfoBanner message={info} />}

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
              setStep("email");
              setCode("");
              setError(null);
              setInfo(null);
            }}
            className="underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSendCode} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
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
          disabled={loading || !email.trim()}
          className="w-full rounded-md py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {loading ? "Sending code…" : "Email me a sign-in code"}
        </button>

        <p
          className="text-center text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          We&apos;ll email you an 8-digit code. No password.
        </p>
      </form>

      {devMode && (
        <details
          className="group mt-2 rounded-md border"
          style={{ borderColor: "var(--border)" }}
        >
          <summary
            className="flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase select-none"
            style={{ color: "var(--text-muted)" }}
          >
            <span>Developer shortcuts</span>
            <span
              className="transition-transform group-open:rotate-90"
              aria-hidden="true"
            >
              ›
            </span>
          </summary>
          <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
            <p
              className="mb-2.5 text-[11px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              Skips OTP. Signs in as a seeded demo account. Dev only.
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
                      backgroundColor:
                        "color-mix(in srgb, var(--text) 2%, transparent)",
                    }}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, " + BRAND_GREEN + " 12%, transparent)",
                        color: BRAND_GREEN,
                      }}
                    >
                      <Icon size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[13px] font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {r.label}
                      </div>
                      <div
                        className="text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
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
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p
      className="rounded-md px-3 py-2 text-sm"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--accent-red) 8%, transparent)",
        color: "var(--accent-red)",
        border:
          "1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)",
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
        backgroundColor:
          "color-mix(in srgb, " + BRAND_GREEN + " 8%, transparent)",
        color: BRAND_GREEN,
        border:
          "1px solid color-mix(in srgb, " + BRAND_GREEN + " 25%, transparent)",
      }}
    >
      {message}
    </p>
  );
}
