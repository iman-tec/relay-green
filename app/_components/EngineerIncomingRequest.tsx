"use client";

/*
 * Engineer-side push notification for an incoming customer request.
 *
 * Mounted globally inside EngineerShell. Whenever a queued session exists
 * (and this engineer is logged in but not currently in a call), a centered
 * Accept / Decline card appears with a soft ringing tone — same UX language
 * as the customer's incoming-call card. Accept fires `claim_session` and
 * navigates to the session room; Decline locally dismisses for this tab.
 *
 * Race-safe: if another engineer claims first, our RPC returns
 * ALREADY_CLAIMED — we just dismiss and the realtime feed surfaces the
 * next queued head (if any).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Phone, X, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN       = "#3f5c2e";
const BRAND_GREEN_SOFT  = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER_SOFT = "rgba(198, 102, 69, 0.14)";
const URGENT_AMBER      = "#c66645";
const CRIT_RED_SOFT     = "rgba(200, 85, 61, 0.18)";
const CRIT_RED          = "#c8553d";

export function EngineerIncomingRequest() {
  const router = useRouter();
  const pathname = usePathname();
  const supabaseRef = useRef(createClient());
  const declinedRef = useRef<Set<string>>(new Set());
  const [request, setRequest] = useState<GuestCall | null>(null);
  const [busy, setBusy] = useState(false);

  // Don't pop notifications while the engineer is already inside a session room.
  const onSessionRoute = pathname?.startsWith("/staff/session/") ?? false;

  // Fetch the head of the queue (filtered against locally-declined ids).
  useEffect(() => {
    const sb = supabaseRef.current;
    let cancelled = false;

    const refresh = async () => {
      if (onSessionRoute) {
        if (!cancelled) setRequest(null);
        return;
      }
      const { data, error } = await sb.rpc("list_queue");
      if (cancelled || error) return;
      const list = ((data ?? []) as GuestCall[]).filter((c) => !declinedRef.current.has(c.id));
      setRequest((prev) => {
        // If we already had one and it's still in the queue, keep it; else swap to new head.
        if (prev && list.some((c) => c.id === prev.id)) return prev;
        return list[0] ?? null;
      });
    };

    void refresh();

    // Realtime: any guest_calls change re-evaluates the queue head.
    const ch = sb
      .channel("engineer-incoming-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_calls" }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(ch);
    };
  }, [onSessionRoute]);

  // Ring sound while a request is showing.
  useEffect(() => {
    if (!request) return;
    let ctx: AudioContext | null = null;
    let iv: ReturnType<typeof setInterval> | null = null;
    try {
      const AudioCtx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      const ring = () => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
      };
      ring();
      iv = setInterval(ring, 1800);
    } catch { /* ignore */ }
    return () => {
      if (iv) clearInterval(iv);
      try { void ctx?.close(); } catch { /* ignore */ }
    };
  }, [request?.id]);

  if (!request || onSessionRoute) return null;

  const urgencyCfg = request.urgency === "critical"
    ? { label: "Critical priority", bg: CRIT_RED_SOFT, fg: CRIT_RED }
    : request.urgency === "urgent"
    ? { label: "Urgent priority", bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : null;

  const onAccept = async () => {
    setBusy(true);
    try {
      const sb = supabaseRef.current;
      const { error } = await sb.rpc("claim_session", { _session_id: request.id });
      if (error) {
        // Race lost, no-auth, or stale — drop the card; the realtime feed will
        // present the next queued head if any.
        declinedRef.current.add(request.id);
        setRequest(null);
        return;
      }
      router.push(`/staff/session/${request.id}`);
    } finally {
      setBusy(false);
    }
  };

  const onDecline = () => {
    declinedRef.current.add(request.id);
    setRequest(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border p-8 text-center shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button
          onClick={onDecline}
          aria-label="Dismiss"
          className="absolute right-4 top-4 opacity-50 transition-opacity hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>

        {urgencyCfg && (
          <div
            className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ backgroundColor: urgencyCfg.bg, color: urgencyCfg.fg }}
          >
            {urgencyCfg.label}
          </div>
        )}

        <div
          className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            backgroundColor: BRAND_GREEN_SOFT,
            color: BRAND_GREEN,
            animation: "engineer-ring 1.4s ease-out infinite",
          }}
        >
          <Phone size={32} />
        </div>

        <div
          className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--text-muted)" }}
        >
          Incoming request
        </div>
        <h2
          className="mb-1 text-2xl font-medium"
          style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}
        >
          {request.guest_name}
        </h2>
        <p className="mb-6 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          is requesting a session with you
        </p>

        <div className="flex gap-2">
          <button
            onClick={onDecline}
            disabled={busy}
            className="flex-1 rounded-full border py-2.5 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Decline
          </button>
          <button
            onClick={() => void onAccept()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
            Accept
          </button>
        </div>
      </div>

      <style>{`
        @keyframes engineer-ring {
          0%   { transform: scale(1);    box-shadow: 0 0 0 0   rgba(63, 92, 46, 0.6); }
          70%  { transform: scale(1.06); box-shadow: 0 0 0 28px rgba(63, 92, 46, 0);   }
          100% { transform: scale(1);    box-shadow: 0 0 0 0   rgba(63, 92, 46, 0);   }
        }
      `}</style>
    </div>
  );
}
