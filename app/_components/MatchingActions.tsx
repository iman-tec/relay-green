"use client";

/*
 * MatchingActions — supervisor/admin override controls for one ringing call
 * (master-prompt §4.3). Dropped into a cell of the matching boards
 * (MatchingPanel, MatchingInline).
 *
 *   "Assign ▾"  → lists assignable engineers (lazy-fetched on open from
 *                 /api/staff/assignable-engineers). Picking one calls the
 *                 supervisor_assign_engineer RPC, which cancels the
 *                 automatic matcher and claims the session for that engineer.
 *   "Cancel"    → two-tap confirm → supervisor_cancel_call RPC, which drops
 *                 the ringing call entirely.
 *
 * The RPCs are SECURITY DEFINER and re-check authority server-side, so this
 * runs as the signed-in user via the browser Supabase client — no extra POST
 * route needed. After a successful action we call onChanged() for an
 * immediate refresh (realtime also picks it up).
 */

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, PhoneOff, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { AssignableEngineer } from "@/app/api/staff/assignable-engineers/route";

function mapError(message: string): string {
  if (message.includes("ENGINEER_BUSY")) return "That engineer is already on a call.";
  if (message.includes("SESSION_UNAVAILABLE")) return "Call is no longer ringing.";
  if (message.includes("NOT_AUTHORIZED")) return "You can't assign that engineer.";
  if (message.includes("NOT_AN_ENGINEER")) return "That user isn't an engineer.";
  if (message.includes("NO_SESSION")) return "No session for this intake.";
  return message || "Something went wrong.";
}

export function MatchingActions({
  intakeId,
  onChanged,
}: {
  intakeId: string;
  onChanged?: () => void;
}) {
  const sbRef = useRef(createClient());
  const [open, setOpen] = useState(false);
  const [engineers, setEngineers] = useState<AssignableEngineer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null); // engineer id | "cancel"
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Fixed-position coords so the menu floats above the table rather than being
  // clipped by the board's overflow-x-auto / overflow-hidden containers.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const loadEngineers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/assignable-engineers", { cache: "no-store" });
      const body = await res.json().catch(() => ({ engineers: [] }));
      setEngineers((body.engineers ?? []) as AssignableEngineer[]);
    } catch {
      setError("Could not load engineers.");
      setEngineers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const r = triggerRef.current?.getBoundingClientRect();
        // Right-align a 256px panel to the button so it never runs off-screen.
        if (r) setCoords({ top: r.bottom + 4, left: Math.max(8, r.right - 256) });
        if (engineers === null) void loadEngineers();
      }
      return next;
    });
  }, [engineers, loadEngineers]);

  const assign = useCallback(async (engineerId: string) => {
    setWorking(engineerId);
    setError(null);
    const { error: e } = await sbRef.current.rpc("supervisor_assign_engineer", {
      _intake_id: intakeId,
      _engineer_user_id: engineerId,
    });
    setWorking(null);
    if (e) { setError(mapError(e.message)); return; }
    setOpen(false);
    onChanged?.();
  }, [intakeId, onChanged]);

  const cancelCall = useCallback(async () => {
    setWorking("cancel");
    setError(null);
    const { error: e } = await sbRef.current.rpc("supervisor_cancel_call", {
      _intake_id: intakeId,
    });
    setWorking(null);
    setConfirmCancel(false);
    if (e) { setError(mapError(e.message)); return; }
    onChanged?.();
  }, [intakeId, onChanged]);

  return (
    <div className="relative flex flex-col items-start gap-1">
      <div className="flex items-center gap-1.5">
        {/* Assign dropdown */}
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleOpen}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
        >
          <UserPlus size={12} /> Assign
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
        </button>

        {/* Cancel (two-tap confirm) */}
        {confirmCancel ? (
          <button
            type="button"
            onClick={() => void cancelCall()}
            disabled={working === "cancel"}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-white"
            style={{ backgroundColor: "var(--risk)" }}
          >
            {working === "cancel" ? <Loader2 size={12} className="animate-spin" /> : <PhoneOff size={12} />}
            Confirm
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--risk)" }}
          >
            <PhoneOff size={12} /> Cancel
          </button>
        )}
        {confirmCancel && (
          <button
            type="button"
            onClick={() => setConfirmCancel(false)}
            className="text-[11px] underline"
            style={{ color: "var(--text-muted)" }}
          >
            keep
          </button>
        )}
      </div>

      {error && (
        <span className="text-[10px]" style={{ color: "var(--risk)" }}>{error}</span>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[var(--z-modal)]" onClick={() => setOpen(false)} />
          {/* Panel — portaled to <body> + fixed so it floats above everything.
              Rendering it inline kept it inside the session Card, whose
              `interactive` hover-transform makes it the containing block for
              `position: fixed` and whose `overflow-hidden` then CLIPPED the
              panel — so the dropdown was invisible. Portaling escapes both. */}
          <div
            className="fixed z-[var(--z-modal)] w-64 overflow-hidden rounded-lg border shadow-xl"
            style={{ top: coords?.top ?? 0, left: coords?.left ?? 0, borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            <div className="border-b px-3 py-2 text-[10px] font-medium tracking-wide uppercase"
                 style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              Assign to engineer
            </div>
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={14} className="animate-spin" style={{ color: "var(--primary)" }} />
              </div>
            ) : !engineers || engineers.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                No engineers available to assign.
              </p>
            ) : (
              // Cap the list at ~4 rows tall; the rest scroll inside with the
              // scrollbar hidden (hide-scrollbar, defined in globals.css) so the
              // panel stays compact however many engineers exist.
              <ul className="hide-scrollbar max-h-[12rem] overflow-y-auto">
                {engineers.map((eng) => {
                  const disabled = eng.busy || working !== null;
                  return (
                    <li key={eng.userId}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void assign(eng.userId)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span
                          aria-hidden
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: eng.busy ? "var(--text-faint)" : eng.available ? "var(--primary)" : "var(--warn)" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" style={{ color: "var(--text)" }}>
                            {eng.displayName}
                          </span>
                          <span className="block truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {eng.busy ? "On a call" : eng.available ? "Available" : "Away"}
                            {eng.podName ? ` · ${eng.podName}` : ""}
                          </span>
                        </span>
                        {working === eng.userId && <Loader2 size={12} className="animate-spin" style={{ color: "var(--primary)" }} />}
                        {!eng.busy && working === null && <Check size={12} style={{ color: "var(--text-faint)" }} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
