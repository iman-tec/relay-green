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
import { Loader2, Wifi } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Modal, cn } from "@/app/_components/ui";

export function EngineerAvailabilityToggle({
  className,
}: {
  className?: string;
}) {
  const sbRef = useRef(createClient());
  const [online, setOnline] = useState<boolean | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Login reminder: if the engineer loads in Offline, prompt them once to go
  // online so they don't silently sit out of the matcher.
  const [promptOpen, setPromptOpen] = useState(false);

  // Load current availability for the signed-in engineer.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb
        .from("engineer_profiles")
        .select("is_available")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!alive) return;
      const avail =
        (data as { is_available?: boolean } | null)?.is_available ?? false;
      setOnline(avail);
      // Show the status prompt ONCE per login (browser session), regardless of
      // current state, so the engineer consciously confirms online/offline and
      // never silently misses calls. Re-shows on a fresh sign-in / new tab.
      const key = `relay-online-prompt:${user.id}`;
      if (typeof window !== "undefined" && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        setPromptOpen(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (online === null || saving) return;
    const next = !online;
    setOnline(next); // optimistic
    setSaving(true);
    setError(null);
    const { error: e } = await sbRef.current.rpc("engineer_set_online", {
      _online: next,
    });
    setSaving(false);
    if (e) {
      setOnline(!next); // revert
      setError(
        e.message.includes("NO_ENGINEER_PROFILE")
          ? "Finish onboarding first."
          : "Couldn't update status."
      );
      setTimeout(() => setError(null), 4000);
    }
  }, [online, saving]);

  const isOnline = online === true;

  return (
    <>
      <div className={cn("flex flex-col items-end gap-1", className)}>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={online === null || saving}
          role="switch"
          aria-checked={isOnline}
          aria-label={
            isOnline
              ? "You're online — tap to go offline"
              : "You're offline — tap to go online"
          }
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
            isOnline
              ? "border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--primary-soft)] text-[var(--text)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
          )}
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <span
              aria-hidden
              className={cn(
                "inline-block size-2.5 rounded-full",
                isOnline ? "bg-[var(--primary)]" : "bg-[var(--text-faint)]"
              )}
            />
          )}
          {online === null ? "…" : isOnline ? "Online" : "Offline"}
        </button>
        {error && (
          <span className="text-[11px] text-[var(--risk)]">{error}</span>
        )}
      </div>

      <Modal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        title={isOnline ? "You're online" : "Set your availability"}
        description={
          isOnline
            ? "You'll receive incoming-call notifications."
            : "Customers can only be matched to engineers who are online."
        }
        footer={
          isOnline ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setPromptOpen(false);
                  void toggle();
                }}
              >
                Go offline
              </Button>
              <Button variant="primary" onClick={() => setPromptOpen(false)}>
                Got it
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPromptOpen(false)}>
                Stay offline
              </Button>
              <Button
                variant="primary"
                iconLeft={<Wifi className="size-4" />}
                onClick={() => {
                  setPromptOpen(false);
                  void toggle();
                }}
              >
                Go online
              </Button>
            </>
          )
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {isOnline
            ? "You're set to receive calls. Toggle off any time from the top bar."
            : "Go online and you'll start receiving incoming-call notifications — while offline, calls are routed to other engineers."}
        </p>
      </Modal>
    </>
  );
}
