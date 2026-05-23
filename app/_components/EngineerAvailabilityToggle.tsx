"use client";

/*
 * EngineerAvailabilityToggle — the engineer's online/offline switch
 * (master-prompt §3.1). "Online" maps to engineer_profiles.is_available,
 * the same flag the matcher rings on. Flipping it calls engineer_set_online,
 * which records the status change and opens/closes the engineer_sessions
 * stint (login/logout logging).
 *
 * Optimistic: the pill flips immediately, reverting if the RPC fails.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { cn } from "@/app/_components/ui";

export function EngineerAvailabilityToggle({ className }: { className?: string }) {
  const sbRef = useRef(createClient());
  const [online, setOnline] = useState<boolean | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current availability for the signed-in engineer.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb
        .from("engineer_profiles")
        .select("is_available")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!alive) return;
      setOnline((data as { is_available?: boolean } | null)?.is_available ?? false);
    })();
    return () => { alive = false; };
  }, []);

  const toggle = useCallback(async () => {
    if (online === null || saving) return;
    const next = !online;
    setOnline(next); // optimistic
    setSaving(true);
    setError(null);
    const { error: e } = await sbRef.current.rpc("engineer_set_online", { _online: next });
    setSaving(false);
    if (e) {
      setOnline(!next); // revert
      setError(e.message.includes("NO_ENGINEER_PROFILE")
        ? "Finish onboarding first."
        : "Couldn't update status.");
      setTimeout(() => setError(null), 4000);
    }
  }, [online, saving]);

  const isOnline = online === true;

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={online === null || saving}
        role="switch"
        aria-checked={isOnline}
        aria-label={isOnline ? "You're online — tap to go offline" : "You're offline — tap to go online"}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isOnline
            ? "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--primary-soft)] text-[var(--text)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]",
        )}
      >
        {saving ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <span
            aria-hidden
            className={cn(
              "inline-block size-2.5 rounded-full",
              isOnline ? "bg-[var(--primary)]" : "bg-[var(--text-faint)]",
            )}
          />
        )}
        {online === null ? "…" : isOnline ? "Online" : "Offline"}
      </button>
      {error && <span className="text-[11px] text-[var(--risk)]">{error}</span>}
    </div>
  );
}
