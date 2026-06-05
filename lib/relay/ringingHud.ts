"use client";

/*
 * Shared "ringing HUD" helpers used by EngineerIncomingRequest and
 * EngineerIncomingMatch. While a call/offer card is on screen, we:
 *
 *   1. Play a 660 Hz pulse via Web Audio every ~1.8 s (skippable via a
 *      localStorage mute flag, also exposed for the toggle to flip).
 *   2. Swap the favicon to /favicon-alert.ico so the tab badge is obviously
 *      "something needs your attention".
 *   3. Blink the document.title between the original and a wake-up label.
 *   4. Fire a single browser Notification on the active→true transition
 *      (after requesting permission once).
 *
 * `useRingingHud({ active, label, body })` returns nothing; mount it from a
 * component that already knows when it's ringing. Each effect cleans itself
 * up when `active` flips back to false.
 *
 * AudioContext: we lazy-create one on first use. The engineer's online-toggle
 * is the user gesture that primes Chrome's autoplay policy; an unprimed
 * context will throw and we silently degrade to visual cues only.
 */

import { useEffect, useRef } from "react";

const MUTE_KEY = "relay-ring-muted";
const ALERT_FAVICON = "/favicon-alert.svg";
const RING_HZ = 660;
const RING_GAIN = 0.045;
const RING_MS = 400;
const RING_PERIOD = 1800;
const BLINK_PERIOD = 900;

/**
 * Mute / unmute the ring sound. Persists in localStorage; consumed by
 * useRingingHud on its next render. Returns the new state.
 */
export function setRingMuted(muted: boolean): boolean {
  if (typeof window === "undefined") return muted;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode / quota — fall through */
  }
  return muted;
}

export function isRingMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

type HudOptions = {
  /** True while the ring card is on screen. */
  active: boolean;
  /** Wake-up label that alternates with the original document.title. */
  label: string;
  /** Body of the browser Notification fired on active→true. */
  body?: string;
  /** Tag — collapses duplicate notifications for the same offer. */
  tag?: string;
};

export function useRingingHud({ active, label, body, tag }: HudOptions): void {
  // Mute flag is read fresh each render so the toggle takes effect on the
  // next ring without re-mounting the consumer.
  const muted = isRingMuted();
  const previousTitleRef = useRef<string | null>(null);
  const previousFaviconRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const notifiedTagRef = useRef<string | null>(null);

  // ── Audio ringer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || muted || typeof window === "undefined") return;
    let ctx: AudioContext | null = audioContextRef.current;
    try {
      if (!ctx) {
        const AudioCtx = (
          window as unknown as { AudioContext?: typeof AudioContext }
        ).AudioContext;
        if (!AudioCtx) return;
        ctx = new AudioCtx();
        audioContextRef.current = ctx;
      }
    } catch {
      return;
    }

    const ring = () => {
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = RING_HZ;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(RING_GAIN, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + RING_MS / 1000);
        osc.start();
        osc.stop(ctx.currentTime + (RING_MS + 50) / 1000);
      } catch {
        /* AudioContext unprimed; degrade silently */
      }
    };
    ring();
    const id = window.setInterval(ring, RING_PERIOD);
    return () => {
      window.clearInterval(id);
    };
  }, [active, muted]);

  // ── Favicon swap ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const head = document.head;
    let link = head.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "icon");
      head.appendChild(link);
    }
    if (previousFaviconRef.current === null) {
      previousFaviconRef.current = link.href ?? "";
    }
    link.href = ALERT_FAVICON;
    return () => {
      if (previousFaviconRef.current !== null && link) {
        link.href = previousFaviconRef.current;
        previousFaviconRef.current = null;
      }
    };
  }, [active]);

  // ── Title blink ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (previousTitleRef.current === null) {
      previousTitleRef.current = document.title;
    }
    const original = previousTitleRef.current ?? document.title;
    let showLabel = true;
    document.title = label;
    const id = window.setInterval(() => {
      showLabel = !showLabel;
      document.title = showLabel ? label : original;
    }, BLINK_PERIOD);
    return () => {
      window.clearInterval(id);
      if (previousTitleRef.current !== null) {
        document.title = previousTitleRef.current;
        previousTitleRef.current = null;
      }
    };
  }, [active, label]);

  // ── Browser Notification — fire once per active episode ───────────────
  useEffect(() => {
    if (!active || typeof window === "undefined" || !("Notification" in window))
      return;
    const notifTag = tag ?? `relay-ring`;
    if (notifiedTagRef.current === notifTag) return;
    notifiedTagRef.current = notifTag;

    const fire = () => {
      try {
        new Notification(label, {
          body: body ?? "Tap to respond",
          tag: notifTag,
          requireInteraction: true,
        });
      } catch {
        /* not allowed / not focused */
      }
    };

    if (Notification.permission === "granted") {
      fire();
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((perm) => {
        if (perm === "granted") fire();
      });
    }
    return () => {
      /* tag-based dedupe; nothing to clean up */
    };
  }, [active, label, body, tag]);

  // Reset notification dedupe when active flips back to false so the next
  // ring with the same tag can fire again.
  useEffect(() => {
    if (!active) notifiedTagRef.current = null;
  }, [active]);
}
