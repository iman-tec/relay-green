"use client";

/*
 * Match-offer → Electron desktop bridge.
 *
 * Lives ONLY inside the hidden /widget/engineer BrowserWindow that the
 * Relay desktop shell keeps alive while the engineer is signed in.
 * Renders nothing.
 *
 * 1. Subscribes to engineer_match_offers for this engineer (realtime +
 *    2s polling fallback).
 * 2. On a new pending offer → fires the native OS toast (relay.notify),
 *    the custom Accept/Decline window (relay.showIncomingCall), and
 *    flashes the tray + taskbar.
 * 3. Bridge IPC: onClaimTrigger → accept_match RPC,
 *               onDeclineTrigger → decline_match RPC.
 * 4. When the offer goes away (accepted by someone, declined, expired,
 *    supersede-flipped) → tears down the bridge state.
 *
 * No changes to match logic, RPCs, or EngineerIncomingMatch (the in-app
 * modal mounted in StaffShell). Both consume the same offer row.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type Offer = {
  id: string;
  intake_id: string;
  guest_call_id: string | null;
  engineer_user_id: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expires_at: string;
};

type Intake = {
  id: string;
  developing: string | null;
};

type Unsubscribe = () => void;
type RelayBridge = {
  notify:            (opts: { title: string; body: string }) => Promise<void>;
  setTrayRinging:    (on: boolean) => void;
  flashFrame:        (on: boolean) => void;
  showIncomingCall:  (data: { sessionId: string; guestName: string; urgency: "normal" | "urgent" | "critical" }) => void;
  hideIncomingCall:  () => void;
  reportClaimResult: (sessionId: string, success: boolean) => void;
  onClaimTrigger:    (cb: (sessionId: string) => void) => Unsubscribe;
  onDeclineTrigger:  (cb: (sessionId: string) => void) => Unsubscribe;
};

function getRelayBridge(): RelayBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { relay?: RelayBridge }).relay ?? null;
}

export function MatchOfferBridge() {
  const supabaseRef = useRef(createClient());
  const myIdRef = useRef<string | null>(null);
  const [offer, setOffer]   = useState<Offer | null>(null);
  const [intake, setIntake] = useState<Intake | null>(null);

  const fetchLatest = useCallback(async () => {
    const myId = myIdRef.current;
    if (!myId) return;
    const sb = supabaseRef.current;
    const { data } = await sb
      .from("engineer_match_offers")
      .select("*")
      .eq("engineer_user_id", myId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("offered_at", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as Offer | undefined;
    if (!row) {
      // Only flush state if we were holding an offer — avoids triggering
      // re-renders when the polling tick returns "still nothing".
      setOffer((prev) => (prev ? null : prev));
      setIntake((prev) => (prev ? null : prev));
      return;
    }
    // Keep object identity stable when polling returns the same row, so
    // useEffect deps keyed on `offer.id` don't re-fire.
    setOffer((prev) => (prev && prev.id === row.id ? prev : row));
    setIntake((prev) => {
      if (prev && prev.id === row.intake_id) return prev;
      return null; // will be refilled by the intake fetch below
    });
    // Only refetch the intake when it's actually a new offer / intake.
    if (intake?.id !== row.intake_id) {
      const { data: intakeRow } = await sb
        .from("client_intakes")
        .select("id, developing")
        .eq("id", row.intake_id)
        .maybeSingle();
      setIntake((intakeRow as Intake) ?? null);
    }
  }, [intake?.id]);

  // ── Subscribe + poll fallback ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabaseRef.current.channel> | null = null;
    let poll:    ReturnType<typeof setInterval> | null = null;
    const sb = supabaseRef.current;
    void (async () => {
      // Auth may not be ready immediately (partitioned cookies still
      // syncing from the main window's sign-in). Retry a few times.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (cancelled) return;
        const { data } = await sb.auth.getUser();
        if (data.user) {
          myIdRef.current = data.user.id;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (cancelled || !myIdRef.current) return;
      await fetchLatest();
      channel = sb
        .channel(`match-offers-bridge:${myIdRef.current}:${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event:  "*",
            schema: "public",
            table:  "engineer_match_offers",
            filter: `engineer_user_id=eq.${myIdRef.current}`,
          },
          () => { void fetchLatest(); },
        )
        .subscribe();
      poll = setInterval(() => { void fetchLatest(); }, 2000);
    })();
    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
      if (poll) clearInterval(poll);
    };
  }, [fetchLatest]);

  // ── Bridge driver ───────────────────────────────────────────────────────
  // Keyed on offer.id so re-fires only happen when a *different* offer
  // arrives. Same offer surfacing on each 2s poll tick is a no-op.
  const offerId = offer?.id ?? null;
  const guestCallId = offer?.guest_call_id ?? null;
  const developing = intake?.developing ?? null;

  useEffect(() => {
    const relay = getRelayBridge();
    if (!relay) return;

    if (!offerId) {
      // Offer just cleared (accepted by another engineer, declined,
      // expired). Tear down the bridge state if we were ringing.
      relay.setTrayRinging?.(false);
      relay.flashFrame?.(false);
      relay.hideIncomingCall?.();
      return;
    }

    const ipcSessionId = guestCallId ?? offerId;
    const title = "Incoming Relay call";
    const body  = developing
      ? `New ${developing} call ringing for you`
      : "A customer is calling you";

    void relay.notify?.({ title, body }).catch(() => {});
    relay.setTrayRinging?.(true);
    relay.flashFrame?.(true);
    relay.showIncomingCall?.({
      sessionId: ipcSessionId,
      guestName: developing ? `New ${developing.toLowerCase()} call` : "Incoming call",
      urgency:   "normal",
    });

    const unsubClaim = relay.onClaimTrigger?.((triggeredId) => {
      if (triggeredId !== ipcSessionId) return;
      void (async () => {
        const sb = supabaseRef.current;
        const { error } = await sb.rpc("accept_match", { _offer_id: offerId });
        relay.reportClaimResult?.(ipcSessionId, !error);
        if (error) setOffer(null);
      })();
    });

    const unsubDecline = relay.onDeclineTrigger?.((triggeredId) => {
      if (triggeredId !== ipcSessionId) return;
      void (async () => {
        await supabaseRef.current.rpc("decline_match", { _offer_id: offerId });
        setOffer(null);
      })();
    });

    return () => {
      unsubClaim?.();
      unsubDecline?.();
    };
  }, [offerId, guestCallId, developing]);

  return null;
}
