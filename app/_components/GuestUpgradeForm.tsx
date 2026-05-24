"use client";

/*
 * GuestUpgradeForm — converts an anonymous Supabase user into a permanent
 * account in place (email + password) via auth.updateUser. The user_id is
 * preserved, so the guest keeps their session, credits, and history.
 *
 * Used in two places:
 *   - Account / settings page — a guest "Create your account" panel.
 *   - PaywallModal — sign-up gate before payment (a guest has no email, so
 *     checkout can't issue a receipt / charge until they register).
 *
 * Requires Supabase "Confirm email" to be OFF for the instant flow: with it
 * off, updateUser({ email, password }) sets the email immediately and the
 * existing session stays valid (no re-login, no email round-trip).
 */

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Input, Toast } from "@/app/_components/ui";

export function GuestUpgradeForm({
  heading = "Create your account",
  blurb = "Add an email and password to save your session and unlock top-ups. Same engineer, same history.",
  ctaLabel = "Create account",
  onUpgraded,
}: {
  heading?: string;
  blurb?: string;
  ctaLabel?: string;
  onUpgraded?: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !em.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { error: upErr } = await sb.auth.updateUser({ email: em, password });
      if (upErr) {
        const msg = upErr.message.toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          throw new Error(
            "That email already has an account. Sign in instead to keep your history.",
          );
        }
        throw upErr;
      }
      onUpgraded?.(em);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg leading-tight text-[var(--text)]">{heading}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">{blurb}</p>
      </div>

      <Input
        label="Email"
        type="email"
        autoComplete="email"
        required
        disabled={busy}
        autoFocus
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        disabled={busy}
        placeholder="At least 8 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <Toast tone="risk">{error}</Toast>}

      <Button type="submit" full loading={busy}>
        {busy ? (
          <>
            <Loader2 size={14} className="mr-1.5 animate-spin" />
            Creating…
          </>
        ) : (
          ctaLabel
        )}
      </Button>
    </form>
  );
}
