"use client";

/*
 * AccountMenu — the shared account chip + dropdown for the bare-mode command
 * centers (reseller / enterprise / department rails). Promoted so sign-out,
 * profile identity and theme live in ONE place and never drift between the
 * three consoles (the rails previously had a read-only identity foot with no
 * way to sign out).
 *
 * Renders a clickable identity chip; the dropdown opens UPWARD (the chip sits
 * at the bottom of the rail) and carries:
 *   - profile header: name + email + sub-label (role/tier)
 *   - the full ThemeTriplet (light / dark / espresso)
 *   - Sign out — the canonical staff sign-out (flip engineer/supervisor
 *     presence off best-effort, then auth.signOut(), then bounce to /staff).
 */

import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";

export type AccountMenuItem = {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  onClick: () => void;
};

export function AccountMenu({
  name,
  email,
  sub,
  items = [],
}: {
  name: string;
  email?: string;
  sub: string;
  /** Extra in-console actions (e.g. Settings) shown above Sign out. */
  items?: AccountMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const sbRef = useRef(createClient());

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    const sb = sbRef.current;
    // Flip presence off before the session dies (no-ops for non-engineer /
    // non-supervisor accounts — they get NOT_AN_ENGINEER / NOT_A_SUPERVISOR).
    try {
      await sb.rpc("engineer_set_online", { _online: false });
    } catch {
      /* best-effort */
    }
    try {
      await sb.rpc("supervisor_set_online", { _online: false });
    } catch {
      /* best-effort */
    }
    try {
      await sb.auth.signOut();
    } finally {
      router.push("/staff");
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border-t px-2.5 pt-3 pb-1 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
          style={{
            background: "var(--primary-tint)",
            color: "var(--primary-hover)",
          }}
        >
          {name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 text-[12px]">
          <div className="truncate font-medium">{name}</div>
          <div className="truncate" style={{ color: "var(--text-faint)" }}>
            {sub}
          </div>
        </div>
        <ChevronUp
          size={14}
          style={{
            color: "var(--text-muted)",
            transform: open ? "none" : "rotate(180deg)",
            transition: "transform 120ms ease",
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-[232px] overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div
            className="border-b px-3 py-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="truncate text-[13px] font-medium">{name}</div>
            {email && (
              <div
                className="truncate text-[12px]"
                style={{ color: "var(--text-muted)" }}
                title={email}
              >
                {email}
              </div>
            )}
            <div
              className="mt-0.5 text-[10px] tracking-[0.06em] uppercase"
              style={{ color: "var(--text-faint)" }}
            >
              {sub}
            </div>
          </div>

          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2.5"
            style={{ borderColor: "var(--border)" }}
          >
            <span
              className="text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              Theme
            </span>
            <ThemeTriplet />
          </div>

          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <it.Icon size={14} />
              {it.label}
            </button>
          ))}

          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={busy}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.04]"
            style={{ color: "var(--risk)" }}
          >
            <LogOut size={14} />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
