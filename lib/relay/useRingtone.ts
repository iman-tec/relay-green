/*
 * useRingtone — Web Audio API "tring tring" mechanical-bell trill
 *
 * Synthesizes a warm UK/India-style telephone ringer (440Hz + 660Hz
 * sine pair, 20Hz amplitude modulation for the clapper-on-bell feel,
 * soft fade-in/out envelope) in real time. Zero audio asset bytes
 * shipped. Two trills per cycle ~200ms apart, then ~1.9s rest.
 *
 * Used by every customer-side "calling an engineer" surface:
 *   • app/intake/matching/[id]/MatchingClient.tsx (full-page ring)
 *   • app/room/RoomClient.tsx CallingModal       (modal ring)
 *
 * Sharing the hook keeps them sonically identical and means tuning
 * cadence / pitch / depth only needs to happen in one place.
 *
 * `enabled` toggles the loop. When false (or component unmounts) we
 * tear down the AudioContext + interval. `available` is true once
 * the AudioContext is in the "running" state — handy for showing a
 * dimmed speaker icon when the browser's autoplay policy is blocking
 * playback.
 */

import { useEffect, useRef, useState } from "react";

export function useRingtone(enabled: boolean): { available: boolean } {
  const [available, setAvailable] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctxRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as
      typeof AudioContext | undefined;
    if (!AC) return;
    let ctx: AudioContext;
    try { ctx = new AC(); } catch { return; }
    ctxRef.current = ctx;
    setAvailable(ctx.state === "running");
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => setAvailable(ctx.state === "running"));
    }

    // One "tring" — a 450ms trilled bell tone. Tremolo LFO modulates
    // a wet gain around a base level for the signature mechanical-bell
    // "rrr" feel without any harshness.
    const playTrill = (t0: number, dur = 0.45) => {
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, t0);
      master.gain.linearRampToValueAtTime(0.13, t0 + 0.03);
      master.gain.setValueAtTime(0.13, t0 + dur - 0.05);
      master.gain.linearRampToValueAtTime(0, t0 + dur);
      master.connect(ctx.destination);

      // Clapper striking the bell ~20× per second.
      const trem = ctx.createGain();
      trem.gain.setValueAtTime(0.5, t0);
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 20;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.5;
      lfo.connect(lfoDepth);
      lfoDepth.connect(trem.gain);
      trem.connect(master);

      // Perfect-fifth pair — warm dual-bell character without metallic
      // inharmonic partials.
      for (const freq of [440, 660]) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(trem);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      }
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    };

    // One "tring tring" cycle = two trills with a 200ms gap.
    const playRing = () => {
      const t0 = ctx.currentTime;
      playTrill(t0);
      playTrill(t0 + 0.65);
    };

    playRing();
    intervalRef.current = setInterval(playRing, 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      try { void ctx.close(); } catch { /* noop */ }
      ctxRef.current = null;
    };
  }, [enabled]);

  return { available };
}
