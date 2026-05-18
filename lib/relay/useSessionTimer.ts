"use client";

/*
 * Server-authoritative live-session timer.
 *
 * Driven by the joined_at timestamp from Postgres. Client just ticks
 * locally — server is consulted on every state UPDATE (Realtime).
 *
 * Two display modes:
 *   - free_countdown  customer's first-ever session, no paid extension —
 *                     counts DOWN from freeMinutes:00 to 00:00.
 *   - paid_elapsed    every other case (free already consumed, paid
 *                     extension active, engineer / supervisor view) —
 *                     counts UP from 00:00 since the anchor. Anchor is
 *                     paidExtensionAt if set, otherwise joinedAt.
 *   - hidden          no joinedAt yet (pre-live).
 *
 * Legacy fields (`elapsed`, `remaining`, `format`, `formatRemaining`,
 * `isWarning`, `isExpired`) remain on the return shape so the engineer-side
 * sidebar (`Live · ${timer.format}`) keeps working with the positional
 * signature.
 */

import { useEffect, useState } from "react";

const FREE_SESSION_SECONDS = 10 * 60;
const WARNING_THRESHOLD_SECONDS = 90;

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
  format: string;            // MM:SS — elapsed since joinedAt (legacy)
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

  const joinedAt = input.joinedAt;
  const freeMinutes = input.freeMinutes ?? 10;
  const isFreeSession = !!input.isFreeSession;
  const paidExtensionAt = input.paidExtensionAt ?? null;

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!joinedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [joinedAt]);

  if (!joinedAt) {
    return {
      elapsed: 0,
      remaining: freeMinutes * 60,
      isWarning: false,
      isExpired: false,
      format: "00:00",
      formatRemaining: format(freeMinutes * 60),
      mode: "hidden",
      display: "00:00",
    };
  }

  const start = new Date(joinedAt).getTime();
  const elapsedSinceJoin = Math.max(0, Math.floor((now - start) / 1000));
  const cap = freeMinutes * 60 || FREE_SESSION_SECONDS;
  const remaining = Math.max(0, cap - elapsedSinceJoin);
  const isExpired = remaining === 0;
  const isWarning = !isExpired && remaining <= WARNING_THRESHOLD_SECONDS;

  // Mode determination. Free countdown only when the caller explicitly
  // signalled "this viewer is on their first free session" AND no paid
  // extension is in flight. Everything else counts up.
  const mode: SessionTimerMode =
    isFreeSession && !paidExtensionAt ? "free_countdown" : "paid_elapsed";

  let display: string;
  if (mode === "free_countdown") {
    display = format(remaining);
  } else {
    // paid_elapsed: anchor on paid_extension_at if set, otherwise joinedAt.
    const paidAnchor = paidExtensionAt ? new Date(paidExtensionAt).getTime() : start;
    const paidElapsed = Math.max(0, Math.floor((now - paidAnchor) / 1000));
    display = format(paidElapsed);
  }

  return {
    elapsed: elapsedSinceJoin,
    remaining,
    isWarning,
    isExpired,
    format: format(elapsedSinceJoin),
    formatRemaining: format(remaining),
    mode,
    display,
  };
}

function format(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
