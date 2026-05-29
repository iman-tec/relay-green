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
import { Check, ChevronDown, Loader2, PhoneOff, UserPlus, Radio } from "lucide-react";
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
  allDeclined = false,
}: {
  intakeId: string;
  onChanged?: () => void;
  /** True for a session every rung engineer has already declined. Surfaces
   *  a prominent "Broadcast to all" action (re-rings every active engineer)
   *  as the primary next step instead of one-off manual assignment. */
  allDeclined?: boolean;
}) {
  const sbRef = useRef(createClient());
  const [open, setOpen] = useState(false);
  const [engineers, setEngineers] = useState<AssignableEngineer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null); // engineer id | "cancel" | "broadcast"
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

  // Re-ring EVERY online engineer for this intake at once (first-accept-wins).
  // Goes through /api/staff/broadcast-match, NOT the match_engineer RPC: the
  // deployed RPC gates on is_available (stuck false for online engineers, so
  // it rings nobody). The endpoint rings anyone heartbeat-fresh. Used when the
  // rung engineer(s) declined.
  const broadcast = useCallback(async () => {
    setWorking("broadcast");
    setError(null);
    try {
      const res = await fetch("/api/staff/broadcast-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intakeId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; offered?: number; stillRinging?: boolean; reassignNeeded?: boolean;
        debug?: Record<string, number>;
      };
      if (!res.ok) { setError(mapError(data.error ?? "")); return; }
      // stillRinging: an earlier broadcast's offers are live — nobody NEW to
      // add, but the call IS ringing. Treat as success and just refresh.
      if ((data.offered ?? 0) === 0 && !data.stillRinging) {
        // Log the breakdown (engineers/fresh/available/busy/declined/ringing)
        // so a surprising "nobody online" is diagnosable from the console.
        if (data.debug) console.warn("[broadcast] nobody eligible:", data.debug);
        setError("No engineers are online to ring right now.");
        return;
      }
    } catch {
      setError("Could not broadcast — try again.");
      return;
    } finally {
      setWorking(null);
    }
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
        {/* After a decline, broadcasting to every active engineer is the
            primary next step — show it first + filled. Manual Assign stays
            available as a secondary control. */}
        {allDeclined && (
          <button
            type="button"
            onClick={() => void broadcast()}
            disabled={working !== null}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--primary)" }}
          >
            {working === "broadcast" ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
            Broadcast to all
          </button>
        )}
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

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Panel — fixed so it floats over the table, not clipped by it */}
          <div
            className="fixed z-50 max-h-72 w-64 overflow-y-auto rounded-lg border shadow-xl"
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
              <ul>
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
        </>
      )}
    </div>
  );
}
