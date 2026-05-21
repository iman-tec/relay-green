"use client";

/*
 * Set-password screen.
 *
 * Shown after OTP verification when the user has no password yet (first
 * signup) OR when the user clicked "Forgot password" and we routed them
 * through OTP to reset. Either way the user's session is already alive
 * via cookies; this screen just collects the new password and calls
 * /api/auth/set-password to persist it.
 *
 * Query string:
 *   ?mode=customer|staff  — drives the landing URL Supabase resolves to
 *   ?continue=<path>      — pre-computed by verify-otp; we honor it if
 *                            present, else the server picks per role.
 *
 * No role-specific UI — same form for every audience.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Eye, EyeOff, Check, X } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { checkPassword, passwordIsValid, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

const BRAND_GREEN = "#3f5c2e";

export function SetPasswordClient() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const mode         = searchParams.get("mode") === "staff" ? "staff" : "customer";
  const continueTo   = searchParams.get("continue") ?? null;

  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [show, setShow]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const checks = checkPassword(password);
  const canSubmit =
    passwordIsValid(password) &&
    password === confirm &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/set-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password, mode }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?:    boolean;
        next?:  string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        // 401 means the cookie session expired between OTP and now;
        // bounce them back to the right login screen.
        if (res.status === 401) {
          router.replace(mode === "staff" ? "/staff/login" : "/login");
          return;
        }
        setError(body.error ?? "Could not save password.");
        return;
      }
      // Prefer the URL the OTP step pre-computed; the server's resolved
      // landing is the fallback.
      window.location.assign(continueTo ?? body.next ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-10 flex flex-col items-center gap-4">
          <Wordmark />
          <div
            className="inline-flex size-12 items-center justify-center rounded-full"
            style={{ background: "rgba(63, 92, 46, 0.14)", color: BRAND_GREEN }}
          >
            <Lock className="size-6" />
          </div>
        </div>

        <header className="mb-8 text-center">
          <h1
            className="text-2xl font-medium tracking-tight sm:text-3xl"
            style={{ color: "var(--text)" }}
          >
            Set a password
          </h1>
          <p
            className="mx-auto mt-3 max-w-sm text-sm leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            One last step. From here on you&apos;ll sign in with your email
            and password — no code needed.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              New password
            </label>
            <div className="relative">
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                autoFocus
                minLength={PASSWORD_MIN_LENGTH}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder={`at least ${PASSWORD_MIN_LENGTH} characters`}
                className="w-full rounded-md border px-3.5 py-2.5 pr-10 text-sm outline-none transition-colors"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface)",
                  color: "var(--text)",
                }}
                onFocus={(e) => (e.target.style.borderColor = BRAND_GREEN)}
                onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                tabIndex={-1}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-2 inline-flex items-center justify-center px-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>

            {/* Live rule checklist. Each turns green + check as it passes. */}
            {password.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 text-xs">
                <RuleRow ok={checks.length}    label={`At least ${PASSWORD_MIN_LENGTH} characters`} />
                <RuleRow ok={checks.lowercase} label="One lowercase letter (a-z)" />
                <RuleRow ok={checks.digit}     label="One number (0-9)" />
                <RuleRow ok={checks.special}   label="One special character (!@#$%&...)" />
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirm"
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              Confirm password
            </label>
            <input
              id="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {confirm.length > 0 && confirm !== password && (
              <p
                className="text-xs"
                style={{ color: "var(--accent-red)" }}
              >
                Passwords don&apos;t match.
              </p>
            )}
          </div>

          {error ? (
            <p
              className="rounded-md px-3 py-2 text-sm"
              style={{
                backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
                color: "var(--accent-red)",
                border: "1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)",
              }}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Saving…" : "Save password"}
          </button>
        </form>
      </div>
    </div>
  );
}

function RuleRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5" style={{ color: ok ? BRAND_GREEN : "var(--text-muted)" }}>
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" style={{ opacity: 0.5 }} />}
      <span>{label}</span>
    </li>
  );
}
