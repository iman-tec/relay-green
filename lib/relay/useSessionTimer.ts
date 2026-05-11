"use client";

/*
 * Server-authoritative live-session timer.
 *
 * Driven by the joined_at timestamp from Postgres. Client just ticks
 * locally — server is consulted on every state UPDATE (Realtime).
 *
 * Returns:
 *   elapsed     — seconds since joined_at
 *   remaining   — seconds left in free 10-min cap (clamped >=0)
 *   isWarning   — within last 90s of free time
 *   isExpired   — past the 10-min cap
 */

import { useEffect, useState } from "react";

const FREE_SESSION_SECONDS = 10 * 60;
const WARNING_THRESHOLD_SECONDS = 90;

export type SessionTimer = {
  elapsed: number;
  remaining: number;
  isWarning: boolean;
  isExpired: boolean;
  format: string;     // "MM:SS"
  formatRemaining: string;
};

export function useSessionTimer(
  joinedAt: string | null,
  freeMinutes: number = 10,
): SessionTimer {
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
    };
  }

  const start = new Date(joinedAt).getTime();
  const elapsed = Math.max(0, Math.floor((now - start) / 1000));
  const cap = freeMinutes * 60 || FREE_SESSION_SECONDS;
  const remaining = Math.max(0, cap - elapsed);
  const isExpired = remaining === 0;
  const isWarning = !isExpired && remaining <= WARNING_THRESHOLD_SECONDS;

  return {
    elapsed,
    remaining,
    isWarning,
    isExpired,
    format: format(elapsed),
    formatRemaining: format(remaining),
  };
}

function format(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
