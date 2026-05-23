/*
 * Session clock — the SINGLE source of truth for "how much time is left".
 *
 * Every surface (customer room header + wallet chip, engineer session room,
 * supervisor pit, admin) and the lifecycle watchdog must agree on the numbers.
 * Previously each computed its own thing off different anchors (the supervise
 * card used joined_at; everything else used assigned_at) and nothing enforced
 * the PAID budget, so a session could keep counting up forever after credits
 * ran out. This module fixes both by deriving one canonical clock.
 *
 * It mirrors the server's billing function `end_session`
 * (supabase/migrations/20260521200000_end_session_employee_billing.sql) exactly:
 *
 *   • The billing anchor is ALWAYS assigned_at (engineer claim). Chat + Zoom
 *     time both count from there.
 *   • Free is binary: a customer's first claimed session is free for up to
 *     `freeMinutes` (10). free_consumed flips once that session ends.
 *   • A RETURNING customer (free already consumed) is billed for the WHOLE
 *     session from assigned_at against their wallet balance.
 *   • A FIRST-TIMER who upgrades mid-session is billed from paid_extension_at.
 *
 * The function is pure — callers pass `now` (Date.now()) so render stays
 * pure for the lint rule. A thin `useSessionClock` hook ticks it once a second.
 */

import { useEffect, useState } from "react";

export const DEFAULT_FREE_MINUTES = 10;
const WARNING_THRESHOLD_SECONDS = 90;

export type SessionClockMode = "free_countdown" | "paid_elapsed" | "hidden";

export type SessionClockInput = {
  /** Billing anchor — assigned_at, falling back to joined_at for legacy rows. */
  anchor: string | null;
  /** Date.now() in ms, supplied by the caller so this stays pure. */
  now: number;
  /** Free cap in minutes. Default 10. */
  freeMinutes?: number;
  /**
   * Customer billing context. OMIT all three for staff/elapsed-only views
   * (engineer room, supervisor pit) — those just count up from the anchor and
   * never enforce anything.
   */
  /** customer_entitlements.free_session_consumed_at != null. */
  freeConsumed?: boolean;
  /** guest_calls.paid_extension_at — set when a first-timer upgrades. */
  paidExtensionAt?: string | null;
  /** credit_wallets.balance snapshot, in minutes. */
  paidMinutesRemaining?: number;
};

export type SessionClock = {
  hasAnchor: boolean;
  mode: SessionClockMode;
  /** Seconds since the billing anchor (assigned_at). */
  elapsedSec: number;
  freeCapSec: number;
  freeRemainingSec: number;
  /** True once on metered paid time (returning customer or mid-session upgrade). */
  onPaid: boolean;
  paidElapsedSec: number;
  /** Wallet budget in seconds, or null when unknown (staff view). */
  paidBudgetSec: number | null;
  /** Remaining paid seconds, or null when unknown. */
  paidRemainingSec: number | null;
  /** Seconds the UI should render for the active `mode`. */
  displaySec: number;
  isWarning: boolean;
  isExpired: boolean;
  // ── Enforcement (only non-trivial when customer billing context is given) ──
  /** Free cap hit with a paid balance available → stamp paid_extension_at. */
  shouldPivotToPaid: boolean;
  /** The session must be ended now. */
  shouldEnd: boolean;
  endReason: "free_session_expired" | "paid_balance_exhausted" | null;
};

export function computeSessionClock(input: SessionClockInput): SessionClock {
  const freeCapSec = (input.freeMinutes ?? DEFAULT_FREE_MINUTES) * 60;

  if (!input.anchor) {
    return {
      hasAnchor: false,
      mode: "hidden",
      elapsedSec: 0,
      freeCapSec,
      freeRemainingSec: freeCapSec,
      onPaid: false,
      paidElapsedSec: 0,
      paidBudgetSec: null,
      paidRemainingSec: null,
      displaySec: 0,
      isWarning: false,
      isExpired: false,
      shouldPivotToPaid: false,
      shouldEnd: false,
      endReason: null,
    };
  }

  const startMs = new Date(input.anchor).getTime();
  const elapsedSec = Math.max(0, Math.floor((input.now - startMs) / 1000));

  // Billing context present only when freeConsumed was supplied (customer side).
  const hasBilling = input.freeConsumed !== undefined;
  const isReturningPaid = !!input.freeConsumed; // whole session is paid
  const pivoted = !!input.paidExtensionAt; // first-timer upgraded mid-session
  const onPaid = hasBilling ? isReturningPaid || pivoted : true;

  const mode: SessionClockMode = onPaid ? "paid_elapsed" : "free_countdown";

  const freeRemainingSec = Math.max(0, freeCapSec - elapsedSec);
  const isExpired = mode === "free_countdown" && freeRemainingSec === 0;
  const isWarning =
    mode === "free_countdown" && !isExpired && freeRemainingSec <= WARNING_THRESHOLD_SECONDS;

  // Paid clock. Returning customers bill from the anchor (assigned_at); a
  // first-timer who upgraded bills from paid_extension_at.
  const paidAnchorMs = pivoted ? new Date(input.paidExtensionAt as string).getTime() : startMs;
  const paidElapsedSec = onPaid ? Math.max(0, Math.floor((input.now - paidAnchorMs) / 1000)) : 0;
  const paidBudgetSec =
    hasBilling && input.paidMinutesRemaining != null
      ? Math.round(input.paidMinutesRemaining * 60)
      : null;
  const paidRemainingSec =
    onPaid && paidBudgetSec != null ? Math.max(0, paidBudgetSec - paidElapsedSec) : null;

  const displaySec = mode === "free_countdown" ? freeRemainingSec : paidElapsedSec;

  // Enforcement — only when we have the customer billing context.
  let shouldPivotToPaid = false;
  let shouldEnd = false;
  let endReason: SessionClock["endReason"] = null;
  if (hasBilling) {
    const balance = input.paidMinutesRemaining ?? 0;
    if (mode === "free_countdown" && freeRemainingSec === 0) {
      if (balance > 0 && !pivoted) {
        shouldPivotToPaid = true;
      } else if (balance <= 0) {
        shouldEnd = true;
        endReason = "free_session_expired";
      }
    } else if (onPaid && paidRemainingSec != null && paidRemainingSec === 0) {
      shouldEnd = true;
      endReason = "paid_balance_exhausted";
    }
  }

  return {
    hasAnchor: true,
    mode,
    elapsedSec,
    freeCapSec,
    freeRemainingSec,
    onPaid,
    paidElapsedSec,
    paidBudgetSec,
    paidRemainingSec,
    displaySec,
    isWarning,
    isExpired,
    shouldPivotToPaid,
    shouldEnd,
    endReason,
  };
}

/** MM:SS (or H:MM:SS past an hour). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Ticking wrapper. Recomputes the clock once a second while the session has an
 * anchor. Pass the same fields as computeSessionClock minus `now`.
 */
export function useSessionClock(input: Omit<SessionClockInput, "now">): SessionClock {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!input.anchor) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [input.anchor]);
  return computeSessionClock({ ...input, now });
}
