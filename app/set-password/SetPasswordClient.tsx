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
 *
 * Phase-3 restyle: endpoint + mode/continue query params + 401 bounce
 * all preserved. Visual layer rebuilt on ui/* primitives.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Eye, EyeOff, Check, X } from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { checkPassword, passwordIsValid, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { Button, Input, Toast, cn } from "@/app/_components/ui";

export function SetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "staff" ? "staff" : "customer";
  const continueTo = searchParams.get("continue") ?? null;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = checkPassword(password);
  const canSubmit = passwordIsValid(password) && password === confirm && !loading;
  const confirmError =
    confirm.length > 0 && confirm !== password ? "Passwords don't match." : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, mode }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        if (res.status === 401) {
          router.replace(mode === "staff" ? "/staff" : "/login");
          return;
        }
        setError(body.error ?? "Could not save password.");
        return;
      }
      window.location.assign(continueTo ?? body.next ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center bg-[var(--background)] px-6 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--primary) 8%, transparent), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Wordmark />
          <div className="inline-flex size-12 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
            <Lock className="size-6" />
          </div>
        </div>

        <header className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-[var(--text)] sm:text-3xl">
            Set a password
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
            One last step. From here on you&apos;ll sign in with your email
            and password — no code needed.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="password"
            label="New password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            minLength={PASSWORD_MIN_LENGTH}
            required
            disabled={loading}
            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            suffix={
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                tabIndex={-1}
                aria-label={show ? "Hide password" : "Show password"}
                className="pointer-events-auto inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />

          {password.length > 0 && (
            <ul className="-mt-1 flex flex-col gap-1 text-xs">
              <RuleRow ok={checks.length} label={`At least ${PASSWORD_MIN_LENGTH} characters`} />
              <RuleRow ok={checks.lowercase} label="One lowercase letter (a-z)" />
              <RuleRow ok={checks.digit} label="One number (0-9)" />
              <RuleRow ok={checks.special} label="One special character (!@#$%&...)" />
            </ul>
          )}

          <Input
            id="confirm"
            label="Confirm password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            disabled={loading}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={confirmError}
          />

          {error && <Toast tone="risk">{error}</Toast>}

          <Button type="submit" full loading={loading} disabled={!canSubmit}>
            {loading ? "Saving…" : "Save password"}
          </Button>
        </form>
      </div>
    </main>
  );
}

function RuleRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 transition-colors",
        ok ? "text-[var(--ok)]" : "text-[var(--text-muted)]",
      )}
    >
      {ok ? (
        <Check className="size-3.5" />
      ) : (
        <X className="size-3.5 opacity-50" />
      )}
      <span>{label}</span>
    </li>
  );
}
