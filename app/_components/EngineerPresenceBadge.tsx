"use client";

/*
 * Always-visible presence pill for the engineer — pinned top-right of the
 * viewport on every staff page. Click opens a 3-state picker (Online /
 * Busy / Offline) that fans out to set_engineer_presence RPC.
 *
 * Realtime-subscribed: if the engineer flips presence in another tab (or
 * via the deeper picker inside the Profile pane), this pill mirrors the
 * change without polling.
 *
 * Mount-gated to engineer roles. Supervisors/admins don't have an
 * `engineer_profiles` row, so this would 404 on the initial fetch — the
 * StaffShell call site already filters by `engineer`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Presence = "online" | "busy" | "offline";

type Opt = { value: Presence; label: string; blurb: string; color: string };

const OPTIONS: readonly Opt[] = [
  {
    value: "online",
    label: "Online",
    blurb: "Matcher rings me",
    color: "#3f5c2e",
  },
  {
    value: "busy",
    label: "Busy",
    blurb: "Customers can request",
    color: "#d4a017",
  },
  {
    value: "offline",
    label: "Offline",
    blurb: "Customers can schedule",
    color: "#94a3b8",
  },
] as const;

function isPresence(v: unknown): v is Presence {
  return v === "online" || v === "busy" || v === "offline";
}

export function EngineerPresenceBadge({ userId }: { userId: string }) {
  const sbRef = useRef(createClient());
  const [presence, setPresence] = useState<Presence | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Initial fetch + realtime subscribe so cross-tab changes mirror in.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;

    void (async () => {
      const { data } = await sb
        .from("engineer_profiles")
        .select("presence_state, is_available")
        .eq("user_id", userId)
        .maybeSingle();
      if (!alive) return;
      const row = (data ?? null) as {
        presence_state: string | null;
        is_available: boolean | null;
      } | null;
      if (!row) {
        // Engineer profile missing — likely a non-engineer landed here.
        // Render nothing rather than guess; matcher state stays correct.
        setPresence(null);
        return;
      }
      if (isPresence(row.presence_state)) {
        setPresence(row.presence_state);
      } else {
        // Pre-migration row — fall back to the legacy is_available flag.
        setPresence(row.is_available ? "online" : "offline");
      }
    })();

    // Per-mount UUID on the channel name so the badge survives a stale
    // sibling subscription colliding under Supabase's name-based dedupe.
    const suffix =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`presence-badge-${userId}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "engineer_profiles",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as {
            presence_state?: string | null;
            is_available?: boolean | null;
          } | null;
          if (!next) return;
          if (isPresence(next.presence_state)) {
            setPresence(next.presence_state);
          } else if (typeof next.is_available === "boolean") {
            setPresence(next.is_available ? "online" : "offline");
          }
        }
      )
      .subscribe();

    return () => {
      alive = false;
      sb.removeChannel(ch);
    };
  }, [userId]);

  // Close on outside-click. Pointerdown captures before any focus change so
  // clicking another button on the page doesn't leave the menu stranded open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onSet = useCallback(
    async (next: Presence) => {
      if (busy || next === presence) {
        setOpen(false);
        return;
      }
      const previous = presence;
      setPresence(next); // optimistic
      setOpen(false);
      setBusy(true);
      try {
        const sb = sbRef.current;
        const { error } = await sb.rpc("set_engineer_presence", {
          _state: next,
        });
        if (error) {
          // Roll back so the pill never lies about what the matcher sees.
          setPresence(previous);
          // Surface the error via console; the deeper Profile pane has the
          // toast UI for richer feedback.
          console.warn("[presence] set failed:", error.message);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, presence]
  );

  // Idle auto-offline removed — presence is fully manual. The engineer stays
  // Online until they explicitly switch to Busy/Offline themselves.

  if (presence === null) return null;

  const current = OPTIONS.find((o) => o.value === presence) ?? OPTIONS[2];

  return (
    <div
      ref={rootRef}
      className="fixed top-3 right-4 z-40"
      style={{ pointerEvents: "auto" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change presence"
        className="group flex items-center gap-2 rounded-full border px-2.5 py-1.5 shadow-sm transition-all hover:shadow-md"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
          color: "var(--text)",
        }}
      >
        <span className="relative flex h-2 w-2">
          {presence === "online" && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full opacity-70"
              style={{
                backgroundColor: current.color,
                animation: "ping 1.6s cubic-bezier(0,0,0.2,1) infinite",
              }}
            />
          )}
          <span
            className="relative h-2 w-2 rounded-full"
            style={{ backgroundColor: current.color }}
          />
        </span>
        <span className="text-[12px] font-medium tracking-tight">
          {current.label}
        </span>
        {busy ? (
          <Loader2
            size={11}
            className="animate-spin"
            style={{ color: "var(--text-muted)" }}
          />
        ) : (
          <ChevronDown
            size={11}
            style={{
              color: "var(--text-muted)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 120ms ease",
            }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1.5 min-w-[220px] overflow-hidden rounded-xl border shadow-xl"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
          }}
        >
          <div
            className="px-3 py-1.5 text-[9px] font-semibold tracking-[0.08em] uppercase"
            style={{ color: "var(--text-faint)" }}
          >
            Set my presence
          </div>
          {OPTIONS.map((opt) => {
            const isActive = opt.value === presence;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitem"
                onClick={() => void onSet(opt.value)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span
                  className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[13px] font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {opt.label}
                    </span>
                    {isActive && (
                      <Check size={11} style={{ color: opt.color }} />
                    )}
                  </div>
                  <div
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {opt.blurb}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
