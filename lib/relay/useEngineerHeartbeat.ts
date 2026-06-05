"use client";

/*
 * Engineer presence heartbeat.
 *
 * Pings public.engineer_heartbeat(_focused) every 10 s and on
 * visibilitychange / beforeunload, so the matcher (20260527120000_match_engineer_v2)
 * can prefer "hot" engineers (last_seen_at within 30 s AND focused) over those
 * who left the tab open and walked away.
 *
 * Pings are SKIPPED while document.hidden is true. The Page Visibility API
 * sets document.hidden=true when the OS screen is locked (Win+L on Windows,
 * Ctrl+Cmd+Q on macOS), the laptop sleeps, the tab is in the background, or
 * the browser window is minimised. Without this gate, locking the PC would
 * keep last_seen_at fresh forever and the server-side reap_idle_engineers()
 * reaper would never flip the engineer offline — defeating the whole point
 * of the 30 s idle threshold. When the screen unlocks, visibilitychange
 * fires, the next ping resumes — but by then >30 s of silence has elapsed,
 * the reaper has flipped them to offline, and they must click Online again
 * (matches the demote-only model in EngineerPresenceBall).
 *
 * Best-effort: errors are swallowed (e.g. NOT_AN_ENGINEER for non-engineer
 * staff who incidentally land on the StaffShell — supervisors are not engineers).
 */

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";

const HEARTBEAT_MS = 10_000;

export function useEngineerHeartbeat(enabled: boolean): void {
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    let cancelled = false;
    const sb = supabaseRef.current;

    async function ping(): Promise<void> {
      if (cancelled) return;
      // Skip when the tab isn't visible — screen lock (Win+L), OS sleep, tab
      // in background, window minimised. document.hidden flipping to true is
      // the signal that the engineer can't see the page and almost certainly
      // can't take a call. Without this guard the interval would keep stamping
      // last_seen_at every 10 s while the engineer is at the lock screen, so
      // the reaper never sees the silence.
      if (document.hidden) return;
      try {
        // Skip when signed out — after a logout in this or another tab the
        // interval otherwise keeps firing unauthenticated RPCs (400 every
        // 10 s in the server log) until the component unmounts. getSession
        // reads local storage only, no network round-trip.
        const { data } = await sb.auth.getSession();
        if (!data.session) return;
        await sb.rpc("engineer_heartbeat", { _focused: document.hasFocus() });
      } catch {
        /* best-effort; suppress NOT_AN_ENGINEER and transient network errors */
      }
    }

    // Fire one immediately on mount so the matcher sees us right away.
    void ping();

    const id = window.setInterval(ping, HEARTBEAT_MS);
    const onVis = () => {
      void ping();
    };
    const onPagehide = () => {
      // Best-effort final ping with focused=false so the matcher de-prioritises
      // us when the tab is being torn down. Uses sendBeacon-style fire-and-forget;
      // the rpc call may not complete before unload but Supabase handles it.
      try {
        void sb.rpc("engineer_heartbeat", { _focused: false });
      } catch {
        /* unload races are fine */
      }
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("blur", onVis);
    window.addEventListener("pagehide", onPagehide);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("blur", onVis);
      window.removeEventListener("pagehide", onPagehide);
    };
  }, [enabled]);
}
