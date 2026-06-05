"use client";

/*
 * SupervisorAvailabilityToggle — the supervisor's on-duty switch.
 *
 * Mirrors EngineerAvailabilityToggle, but for supervisors. "Online" maps to
 * supervisor_presence.is_online and is what the coverage failover reads: an
 * ONLINE supervisor is eligible to cover sessions (their own pod first, then
 * any pod whose supervisor is offline). Going offline re-routes everything
 * they were covering to whoever is still online — handled server-side in
 * supervisor_set_online (migration 20260524100000).
 *
 * Like the engineer toggle, it prompts once per login so a supervisor never
 * silently sits out of coverage. Optimistic: flips immediately, reverts on
 * RPC failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Wifi } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Modal, cn } from "@/app/_components/ui";

export function SupervisorAvailabilityToggle({
  className,
}: {
  className?: string;
}) {
  const sbRef = useRef(createClient());
  const [online, setOnline] = useState<boolean | null>(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb
        .from("supervisor_presence")
        .select("is_online")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!alive) return;
      const isOn = (data as { is_online?: boolean } | null)?.is_online ?? false;
      setOnline(isOn);
      // Prompt ONCE per login (browser session), regardless of current state,
      // so the supervisor consciously confirms coverage and never silently
      // leaves a pod uncovered. Separate sessionStorage key from the engineer
      // prompt so a dual-role user gets both.
      const key = `relay-supervisor-online-prompt:${user.id}`;
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
    const { error: e } = await sbRef.current.rpc("supervisor_set_online", {
      _online: next,
    });
    setSaving(false);
    if (e) {
      setOnline(!next); // revert
      setError(
        e.message.includes("NOT_A_SUPERVISOR")
          ? "Supervisor access only."
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
          {online === null ? "…" : isOnline ? "On duty" : "Off duty"}
        </button>
        {error && (
          <span className="text-[11px] text-[var(--risk)]">{error}</span>
        )}
      </div>

      <Modal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        title={isOnline ? "You're on duty" : "Go on duty?"}
        description={
          isOnline
            ? "You'll cover your pod and pick up sessions when other supervisors are offline."
            : "Sessions can only be covered by supervisors who are on duty."
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
                Go off duty
              </Button>
              <Button variant="primary" onClick={() => setPromptOpen(false)}>
                Got it
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPromptOpen(false)}>
                Stay off duty
              </Button>
              <Button
                variant="primary"
                iconLeft={<Wifi className="size-4" />}
                onClick={() => {
                  setPromptOpen(false);
                  void toggle();
                }}
              >
                Go on duty
              </Button>
            </>
          )
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {isOnline
            ? "You're covering live sessions. Toggle off any time — anything you're watching re-routes to another on-duty supervisor."
            : "Go on duty to watch your pod's live sessions and automatically cover for supervisors who are offline, so no session is ever left unsupervised."}
        </p>
      </Modal>
    </>
  );
}
