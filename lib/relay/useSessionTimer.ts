"use client";

/*
 * Server-authoritative live-session timer.
 *
 * Thin compatibility wrapper over the canonical clock in
 * `lib/relay/sessionClock.ts` — kept so existing call sites (the customer
 * room header LiveTimer and the engineer/supervisor sidebar) don't change.
 * ALL of the actual math lives in computeSessionClock so every surface agrees.
 *
 * Two display modes:
 *   - free_countdown  customer's first-ever session, no paid extension —
 *                     counts DOWN from freeMinutes:00 to 00:00.
 *   - paid_elapsed    every other case (free already consumed, paid
 *                     extension active, engineer / supervisor view) —
 *                     counts UP from 00:00 since the anchor (assigned_at, or
 *                     paid_extension_at once a first-timer upgrades).
 *   - hidden          no anchor yet (pre-live).
 *
 * Legacy fields (`elapsed`, `remaining`, `format`, `formatRemaining`,
 * `isWarning`, `isExpired`) remain on the return shape so the engineer-side
 * sidebar (`Live · ${timer.format}`) keeps working with the positional
 * signature.
 */

import { computeSessionClock, formatClock } from "./sessionClock";
import { useEffect, useState } from "react";

export type SessionTimerMode = "free_countdown" | "paid_elapsed" | "hidden";

export type SessionTimerInput = {
  joinedAt: string | null;
  /** Cap in minutes for free countdown. Default 10. */
  freeMinutes?: number;
  /** Customer-side: viewer is on their first session (free quota not yet
   *  consumed) AND no paid extension stamp. Engineer / supervisor callers
   *  can omit this — they default to paid_elapsed (counts up). */
  isFreeSession?: boolean;
  /** Customer-side: timestamp the session pivoted onto paid time. If set,
   *  paid_elapsed counts from here; otherwise it counts from joinedAt. */
  paidExtensionAt?: string | null;
};

export type SessionTimer = {
  elapsed: number;
  remaining: number;
  isWarning: boolean;
  isExpired: boolean;
  format: string;            // MM:SS — elapsed since anchor (legacy)
  formatRemaining: string;   // MM:SS — remaining in free cap (legacy)
  mode: SessionTimerMode;
  display: string;           // MM:SS — what the UI should render in `mode`
};

export function useSessionTimer(
  joinedAtOrInput: string | null | SessionTimerInput,
  legacyFreeMinutes?: number,
): SessionTimer {
  // Normalize positional callers (`useSessionTimer(joinedAt, freeMinutes)`)
  // into the object form. The engineer / supervisor sidebar uses positional.
  const input: SessionTimerInput =
    typeof joinedAtOrInput === "object" && joinedAtOrInput !== null && "joinedAt" in joinedAtOrInput
      ? joinedAtOrInput
      : { joinedAt: joinedAtOrInput as string | null, freeMinutes: legacyFreeMinutes };

  // Tick at 250ms (sub-second) so the visible MM:SS rolls over within a
  // quarter-second of crossing the next second boundary, and `Date.now()`
  // is read FRESH at render time — using a `now` state captured at hook
  // mount caused the first second to flash "00:-1" or stick at "00:00"
  // because the state was stale relative to a later-arriving anchor.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!input.joinedAt) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, [input.joinedAt]);

  // isFreeSession (free quota not yet consumed) maps to the clock's
  // freeConsumed flag (its inverse). When the caller omits isFreeSession
  // (engineer / supervisor), we leave freeConsumed undefined so the clock
  // runs in staff/elapsed mode (counts up, no enforcement).
  const clock = computeSessionClock({
    anchor: input.joinedAt,
    now: Date.now(),
    freeMinutes: input.freeMinutes,
    freeConsumed: input.isFreeSession === undefined ? undefined : !input.isFreeSession,
    paidExtensionAt: input.paidExtensionAt ?? null,
  });

  return {
    elapsed: clock.elapsedSec,
    remaining: clock.freeRemainingSec,
    isWarning: clock.isWarning,
    isExpired: clock.isExpired,
    format: formatClock(clock.elapsedSec),
    formatRemaining: formatClock(clock.freeRemainingSec),
    mode: clock.mode,
    display: formatClock(clock.displaySec),
  };
}
