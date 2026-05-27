"use client";

/*
 * Engineer presence heartbeat.
 *
 * Pings public.engineer_heartbeat(_focused) every 10 s and on
 * visibilitychange / beforeunload, so the matcher (20260527120000_match_engineer_v2)
 * can prefer "hot" engineers (last_seen_at within 30 s AND focused) over those
 * who left the tab open and walked away.
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
      try {
        await sb.rpc("engineer_heartbeat", { _focused: document.hasFocus() });
      } catch {
        /* best-effort; suppress NOT_AN_ENGINEER and transient network errors */
      }
    }

    // Fire one immediately on mount so the matcher sees us right away.
    void ping();

    const id = window.setInterval(ping, HEARTBEAT_MS);
    const onVis = () => { void ping(); };
    const onPagehide = () => {
      // Best-effort final ping with focused=false so the matcher de-prioritises
      // us when the tab is being torn down. Uses sendBeacon-style fire-and-forget;
      // the rpc call may not complete before unload but Supabase handles it.
      try {
        void sb.rpc("engineer_heartbeat", { _focused: false });
      } catch { /* unload races are fine */ }
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
