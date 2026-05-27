"use client";

/*
 * Single-glance presence indicator — a coloured ball that lives in the
 * StaffShell sidebar (under the nav items). Replaces both the inline
 * "Available" pill in the dashboard header AND the floating top-right
 * EngineerPresenceBadge.
 *
 * States:
 *   green     — Online (available; matcher rings me)
 *   saffron   — Busy (matcher skips, customer can request)
 *   grey      — Offline (matcher skips, customer schedules ahead)
 *
 * Incoming-call behaviour: realtime-subscribed to engineer_match_offers
 * (status = pending, engineer_user_id = me). On INSERT we:
 *   1. flip the ball into a "heartbeat" pulse (CSS @keyframes relay-heartbeat)
 *   2. ring a soft tone via Web Audio (skipped when muted)
 *   3. surface a mute toggle inline next to the ball so the engineer
 *      can silence the audio without losing the visual ring
 *
 * Mute preference is stored in localStorage so it survives reloads.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Phone, Volume2, VolumeX } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Presence = "online" | "busy" | "offline";

// Shape of a pending callback we surface on the ball. Mirrors a subset of
// engineer_connect_requests so the ball can ring with the customer's name.
type PendingCallback = {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  projectName: string | null;
  createdAt: string;
};

// Auto-ring delay when presence flips Busy/Offline → Online. The user
// explicitly asked for "after 30 seconds" so this is a hard 30000ms.
const CALLBACK_AUTO_RING_MS = 30_000;

// Idle threshold for auto-flipping the engineer to "offline" / grey
// when no input activity is detected. 5 minutes matches Slack/Discord's
// "auto-away" default — long enough that a focused engineer reading
// docs isn't yanked away, short enough that a step-away-from-PC is
// reflected promptly.
const IDLE_MS = 5 * 60_000;

function isPresence(v: unknown): v is Presence {
  return v === "online" || v === "busy" || v === "offline";
}

const MUTE_KEY = "relay.engineer.ring.muted.v1";

// Presence → colour. The "saffron" the user asked for reads as warm
// orange against both light and dark canvases.
const COLOURS: Record<Presence, { fill: string; ring: string; label: string }> = {
  online:  { fill: "#3f5c2e", ring: "rgba(63, 92, 46, 0.5)",   label: "Online"  },
  busy:    { fill: "#e8932b", ring: "rgba(232, 147, 43, 0.5)", label: "Busy"    },
  offline: { fill: "#94a3b8", ring: "rgba(148, 163, 184, 0.4)", label: "Offline" },
};

export function EngineerPresenceBall({
  userId, collapsed,
}: {
  userId: string;
  /** When true (sidebar collapsed in StaffShell), render just the ball
   *  with no label or mute button. Saves horizontal space; everything is
   *  still reachable by expanding the sidebar. */
  collapsed: boolean;
}) {
  const sbRef = useRef(createClient());
  const [presence, setPresence] = useState<Presence | null>(null);
  // Mirror presence into a ref so recompute() (a stable useCallback) can
  // read the latest value without being re-armed on every state change.
  // Required because the auto-presence rule now BRANCHES on current
  // presence — we only auto-flip online→offline when going idle, and
  // we never auto-promote anything to online.
  const presenceRef = useRef<Presence | null>(null);
  useEffect(() => { presenceRef.current = presence; }, [presence]);
  const [incoming, setIncoming] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Callback-ring state ────────────────────────────────────────────
  // Pending callback requests for THIS engineer (FIFO; oldest first).
  // When presence transitions to "online" and this list is non-empty,
  // the ball arms a 30s timer; on fire it lights up `incoming` and
  // surfaces the oldest customer's name. Click → accept_connect_request.
  // Cleared automatically by the realtime sub when the row leaves
  // "pending" (accepted/declined elsewhere, e.g. the dashboard card).
  const [callbacks, setCallbacks] = useState<PendingCallback[]>([]);
  // Which callback (if any) is the one currently being rung. We hold it
  // in state so the label/click handler can read it even after the FIFO
  // list shifts.
  const [activeCallback, setActiveCallback] = useState<PendingCallback | null>(null);
  // Track previous presence so we can detect the Busy/Offline → Online
  // edge that arms the 30s timer.
  const prevPresenceRef = useRef<Presence | null>(null);
  // Holds the timeout ID so it can be cleared on presence change /
  // unmount / queue-empties-out.
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror the latest muted flag into a ref so the timer callback reads
  // the most recent value without needing to be re-armed on mute toggle.
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  // Same trick for the callbacks list — the timer fires N seconds in
  // the future and must read the latest queue head at fire time.
  const callbacksRef = useRef<PendingCallback[]>([]);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

  // Restore mute preference from localStorage on mount.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MUTE_KEY);
      if (v === "1") setMuted(true);
    } catch { /* private mode */ }
  }, []);

  // Persist mute preference whenever it flips.
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  // Presence — initial load + realtime sub on engineer_profiles.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data } = await sb
        .from("engineer_profiles")
        .select("presence_state, is_available")
        .eq("user_id", userId)
        .maybeSingle();
      if (!alive) return;
      const row = (data ?? null) as { presence_state: string | null; is_available: boolean | null } | null;
      if (!row) { setPresence("offline"); return; }
      if (isPresence(row.presence_state)) setPresence(row.presence_state);
      else setPresence(row.is_available ? "online" : "offline");
    })();

    // Per-mount UUID suffix so two open tabs (or a quick remount during
    // route navigation) don't trip Supabase's name-based channel dedupe.
    const suffix = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`presence-ball-${userId}-${suffix}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "engineer_profiles", filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as { presence_state?: string | null; is_available?: boolean | null } | null;
          if (!next) return;
          if (isPresence(next.presence_state)) setPresence(next.presence_state);
          else if (typeof next.is_available === "boolean") setPresence(next.is_available ? "online" : "offline");
        },
      )
      .subscribe();

    return () => { alive = false; sb.removeChannel(ch); };
  }, [userId]);

  // Incoming-call detection — listen for engineer_match_offers rows where
  // status=pending and engineer_user_id matches. INSERTS trigger the ring;
  // UPDATEs to accepted/declined/expired clear it.
  useEffect(() => {
    const sb = sbRef.current;
    const suffix = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`presence-ball-offers-${userId}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "engineer_match_offers",
          filter: `engineer_user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as { status?: string } | null;
          const old = payload.old as { status?: string } | null;
          if (payload.eventType === "INSERT" && next?.status === "pending") {
            setIncoming(true);
            playRingtone(muted);
          } else if (payload.eventType === "UPDATE") {
            // Any transition out of pending closes the ring (accepted /
            // declined / expired). EngineerIncomingMatch handles the
            // accept/decline UI; we just mirror the visual.
            if (next && next.status !== "pending" && old?.status === "pending") {
              setIncoming(false);
            }
          } else if (payload.eventType === "DELETE") {
            setIncoming(false);
          }
        },
      )
      .subscribe();
    return () => { sb.removeChannel(ch); };
    // muted intentionally NOT in deps — we want the latest muted value
    // at callback time, which the closure already captures via ref-free
    // state lookup since playRingtone reads at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Also poll for any unattended pending offers on mount — covers the case
  // where the engineer reloaded mid-ring or the realtime channel was
  // late to subscribe.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;
    void (async () => {
      const { data } = await sb
        .from("engineer_match_offers")
        .select("id, status, expires_at")
        .eq("engineer_user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .limit(1);
      if (!alive) return;
      if (data && data.length > 0) setIncoming(true);
    })();
    return () => { alive = false; };
  }, [userId]);

  // ── Auto-presence: one-way ratchet (demote-only) ──────────────────
  // The auto-detector reflects ground truth in ONE direction: it can
  // demote an engineer down the availability ladder, but never promote.
  //
  //   • on a live call          → busy   (always — even if currently offline,
  //                                       because they're clearly engaged)
  //   • idle > 5 min WHILE online → offline (only kicks in if they were online)
  //   • free at the PC          → NO auto-change. Engineer must
  //                                explicitly choose "online" via the menu.
  //
  // Why: the engineer's session starts at "offline" (DB default) so
  // login doesn't drop them into the matcher queue before they're ready.
  // Auto-promoting them to "online" because they merely loaded the page
  // would re-introduce the bug we're fixing. Promotion is reserved for
  // the manual menu pick in onSet().
  const isOnCallRef = useRef(false);
  const isIdleRef = useRef(false);
  // Tracks the last value we (auto) wrote to the DB. Prevents redundant
  // writes when the same condition re-fires (e.g. multiple mousemoves
  // both call markActive while we're already known to be active).
  const lastAutoWriteRef = useRef<Presence | null>(null);

  const recompute = useCallback(async () => {
    const current = presenceRef.current;
    // Decide the desired demotion (if any). Null means "no auto-change".
    let desired: Presence | null = null;
    if (isOnCallRef.current) {
      // On a call → busy. Always — engineers shouldn't appear available
      // while they're actively engaged.
      desired = "busy";
    } else if (isIdleRef.current && current !== "offline") {
      // Idle and currently at any non-offline state → demote to offline.
      // Applies to both online and busy: an engineer who set themselves
      // Busy and then walked away should still show as Offline after 5
      // min, not "Busy forever".
      desired = "offline";
    }
    // No "else → online" branch. The engineer must explicitly choose
    // online via the menu — auto-detection only demotes.

    if (desired === null) return;
    if (desired === current) return;
    lastAutoWriteRef.current = desired;
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("set_engineer_presence", { _state: desired });
      if (error) console.warn("[presence-auto] set failed:", error.message);
    } catch (err) {
      console.warn("[presence-auto] set threw:", err);
    }
  }, []);

  // On-call detection — subscribe to my active claimed sessions. Any
  // session in assigned/joining/live/grace counts as "on a call".
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;

    const refreshOnCall = async () => {
      const { data, error } = await sb
        .from("guest_calls")
        .select("id")
        .eq("claimed_by", userId)
        .in("status", ["assigned", "joining", "live", "grace"])
        .limit(1);
      if (!alive) return;
      if (error) { return; }
      const onCall = (data?.length ?? 0) > 0;
      if (onCall !== isOnCallRef.current) {
        isOnCallRef.current = onCall;
        void recompute();
      }
    };

    void refreshOnCall();

    const suffix = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`presence-auto-call-${userId}-${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guest_calls", filter: `claimed_by=eq.${userId}` },
        () => { void refreshOnCall(); },
      )
      .subscribe();

    return () => { alive = false; sb.removeChannel(ch); };
  }, [userId, recompute]);

  // Idle detection — any mousemove / keypress / touch / window-focus
  // resets the timer. Tab visibility change also counts as activity
  // when the tab becomes visible.
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const markActive = () => {
      if (isIdleRef.current) {
        isIdleRef.current = false;
        void recompute();
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!isIdleRef.current) {
          isIdleRef.current = true;
          void recompute();
        }
      }, IDLE_MS);
    };

    const onVisibility = () => {
      if (!document.hidden) markActive();
    };

    // Initial arm — counts mount as activity.
    markActive();

    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "touchstart", "focus"];
    events.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, markActive));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [recompute]);

  // ── Pending-callback tracking ─────────────────────────────────────
  // Load + realtime-subscribe to engineer_connect_requests for THIS
  // engineer where status=pending. Drives the 30s auto-ring + the
  // customer-name label.
  useEffect(() => {
    const sb = sbRef.current;
    let alive = true;

    const enrich = async (row: {
      id: string;
      customer_user_id: string;
      project_id: string | null;
      created_at: string;
    }): Promise<PendingCallback> => {
      const [custRes, projRes] = await Promise.all([
        sb.from("customer_profiles").select("display_name, email").eq("user_id", row.customer_user_id).maybeSingle(),
        row.project_id ? sb.from("projects").select("name").eq("id", row.project_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const cust = (custRes.data ?? null) as { display_name: string | null; email: string | null } | null;
      const proj = (projRes.data ?? null) as { name: string | null } | null;
      return {
        id: row.id,
        customerName: cust?.display_name ?? null,
        customerEmail: cust?.email ?? null,
        projectName: proj?.name ?? null,
        createdAt: row.created_at,
      };
    };

    void (async () => {
      const { data } = await sb
        .from("engineer_connect_requests")
        .select("id, customer_user_id, project_id, created_at")
        .eq("engineer_user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (!alive) return;
      const rows = (data ?? []) as Array<{
        id: string; customer_user_id: string; project_id: string | null; created_at: string;
      }>;
      const enriched = await Promise.all(rows.map(enrich));
      if (!alive) return;
      setCallbacks(enriched);
    })();

    const ringSuffix = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = sb
      .channel(`presence-ball-callbacks-${userId}-${ringSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "engineer_connect_requests",
          filter: `engineer_user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as {
            id: string; customer_user_id: string; project_id: string | null;
            created_at: string; status?: string;
          } | null;
          const old = payload.old as { id?: string } | null;
          // DELETE or row no longer pending → drop from list.
          if (!next && old?.id) {
            setCallbacks((prev) => prev.filter((c) => c.id !== old.id));
            return;
          }
          if (!next) return;
          if (next.status !== "pending") {
            setCallbacks((prev) => prev.filter((c) => c.id !== next.id));
            return;
          }
          void enrich(next).then((enriched) => {
            if (!alive) return;
            setCallbacks((prev) => {
              const without = prev.filter((c) => c.id !== enriched.id);
              return [...without, enriched].sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
              );
            });
          });
        },
      )
      .subscribe();

    return () => { alive = false; sb.removeChannel(ch); };
  }, [userId]);

  // ── 30s auto-ring on Busy/Offline → Online transition ─────────────
  // Arm a one-shot timer the moment presence becomes "online" while
  // there's at least one pending callback. If presence changes again
  // (or the queue empties) before it fires, cancel cleanly. We also
  // cancel + clear `activeCallback` whenever the engineer leaves the
  // online state so the ring doesn't keep visually screaming after
  // they've explicitly stepped away.
  useEffect(() => {
    const prev = prevPresenceRef.current;
    prevPresenceRef.current = presence;

    // Clear any existing timer up front — every presence change starts
    // from a clean slate.
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }

    if (presence !== "online") {
      // Engineer is no longer Online → silence and forget the active
      // callback. They can re-arm by toggling back to Online.
      // Unconditional setters here are safe: React no-ops setState calls
      // that don't change the value. The previous conditional `if
      // (activeCallback)` meant `activeCallback` had to be in the dep
      // array, which made THIS effect re-run on every callback-state
      // change — and the clearTimeout at the top of the effect would
      // then cancel an in-flight 30s ring timer. That race silently
      // de-armed the callback ring.
      setActiveCallback(null);
      setIncoming(false);
      return;
    }

    // We're Online. Only arm the timer on an EDGE — i.e. presence
    // changed from a non-online state to online — to avoid re-arming on
    // every callbacks-list mutation while the engineer is already Online.
    if (prev === "online") return;

    if (callbacksRef.current.length === 0) return;

    ringTimerRef.current = setTimeout(() => {
      // Refresh from ref in case the queue mutated during the wait.
      const head = callbacksRef.current[0];
      if (!head) return;
      setActiveCallback(head);
      setIncoming(true);
      playRingtone(mutedRef.current);
    }, CALLBACK_AUTO_RING_MS);
    // Intentionally NOT including activeCallback in the deps — see the
    // comment above. The presence edge is the only legitimate trigger
    // for re-arming. activeCallback is read via callbacksRef inside the
    // timer body, so no stale-closure risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence]);

  // If the active callback row disappears from the queue (accepted /
  // declined elsewhere), tear the ring down so the ball returns to a
  // calm Online state.
  useEffect(() => {
    if (!activeCallback) return;
    const stillThere = callbacks.some((c) => c.id === activeCallback.id);
    if (!stillThere) {
      setActiveCallback(null);
      setIncoming(false);
    }
  }, [callbacks, activeCallback]);

  // Cleanup the pending timer on unmount.
  useEffect(() => () => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  // Accept the currently-ringing callback. Uses the same RPC as the
  // dashboard card so the audit trail is identical. After accept, the
  // customer-side flow creates the actual session; the engineer will
  // see it land in their Active list via the existing workspace stream.
  const acceptActiveCallback = useCallback(async () => {
    if (!activeCallback) return;
    const id = activeCallback.id;
    const sb = sbRef.current;
    // Tear down the ring optimistically — the realtime sub will also
    // clean up but we don't want the user staring at a ringing ball
    // while the network call resolves.
    setIncoming(false);
    setActiveCallback(null);
    setCallbacks((prev) => prev.filter((c) => c.id !== id));
    const { error } = await sb.rpc("accept_connect_request", { _id: id });
    if (error) {
      console.warn("[presence-ball] accept_connect_request failed:", error.message);
    }
  }, [activeCallback]);

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const onSet = useCallback(async (next: Presence) => {
    if (presence === next) { setMenuOpen(false); return; }
    const previous = presence;
    setPresence(next);
    setMenuOpen(false);
    try {
      const sb = sbRef.current;
      const { error } = await sb.rpc("set_engineer_presence", { _state: next });
      if (error) {
        setPresence(previous);
        console.warn("[presence-ball] set failed:", error.message);
      }
    } catch (err) {
      setPresence(previous);
      console.warn("[presence-ball] set threw:", err);
    }
  }, [presence]);

  if (presence === null) {
    // First-paint placeholder so the layout doesn't jump when the row
    // arrives. Stays grey until presence resolves.
    return collapsed ? (
      <div className="flex justify-center py-3">
        <span className="size-9 rounded-full" style={{ backgroundColor: "#94a3b8", opacity: 0.25 }} />
      </div>
    ) : null;
  }

  const c = COLOURS[presence];

  // Big-ball variant — designed to be the loudest element in the sidebar
  // when an incoming call lands. Sized like the customer-side "Connect to
  // Relay Engineer" button so engineers can spot a ringing call from
  // across the room. Collapsed sidebar shrinks it to a clear 36px puck.
  const ballPx = collapsed ? 36 : 96;
  const iconPx = collapsed ? 14 : 32;
  const ballStyle: React.CSSProperties = {
    width: ballPx,
    height: ballPx,
    backgroundColor: c.fill,
    color: c.fill, // drives currentColor in the heartbeat keyframe glow
    boxShadow: incoming
      ? `0 0 0 0 ${c.ring}, 0 4px 16px ${c.ring}`
      : presence === "online"
        ? `0 0 0 0 ${c.ring}, 0 4px 12px color-mix(in srgb, ${c.fill} 35%, transparent)`
        : `0 2px 6px rgba(0,0,0,0.18)`,
    animation: incoming
      ? "relay-heartbeat 1100ms ease-in-out infinite"
      : presence === "online"
        ? "relay-pulse-ok 2400ms ease-in-out infinite"
        : "none",
    transition: "background-color 200ms ease, box-shadow 200ms ease",
  };

  return (
    <div ref={rootRef} className="relative flex flex-col items-center gap-2 py-3">
      <button
        type="button"
        onClick={() => {
          // If a callback is actively ringing, the primary action is to
          // accept it — clicking the ball connects the customer. Other
          // incoming sources (engineer_match_offers) still defer to the
          // popup UI, since they have their own accept/decline flow.
          if (incoming && activeCallback) {
            void acceptActiveCallback();
            return;
          }
          setMenuOpen((v) => !v);
        }}
        aria-haspopup={incoming && activeCallback ? undefined : "menu"}
        aria-expanded={incoming && activeCallback ? undefined : menuOpen}
        title={
          incoming && activeCallback
            ? `Connect ${activeCallback.customerName ?? activeCallback.customerEmail ?? "customer"}`
            : incoming
              ? "Incoming call — open the popup to accept"
              : `${c.label} · click to change presence`
        }
        className="relative inline-flex items-center justify-center rounded-full transition-transform hover:scale-[1.03]"
        style={ballStyle}
      >
        {/* Phone glyph stays subtle when idle (white at low alpha) and
            crisp white during a ring. Doubles as the visual confirmation
            that this circle IS a presence/call indicator and not just a
            decorative dot. */}
        <Phone
          size={iconPx}
          strokeWidth={2.4}
          style={{
            color: "#ffffff",
            opacity: incoming ? 1 : presence === "online" ? 0.95 : 0.55,
          }}
        />
        {incoming && !collapsed && (
          <span
            className="absolute -bottom-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: c.fill,
              color: "#fff",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            Ringing
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="flex flex-col items-center gap-1">
          <div
            className="text-[13px] font-semibold tracking-tight"
            style={{ color: incoming ? c.fill : "var(--text)" }}
          >
            {incoming && activeCallback
              ? (activeCallback.customerName ?? activeCallback.customerEmail ?? "Customer")
              : incoming
                ? "Incoming call"
                : c.label}
          </div>
          {incoming && activeCallback ? (
            <div className="text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
              {activeCallback.projectName ? `${activeCallback.projectName} · ` : ""}
              Tap to connect
            </div>
          ) : !incoming ? (
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {presence === "online"
                ? callbacks.length > 0
                  ? `${callbacks.length} waiting · rings in 30s`
                  : "Matcher rings me"
                : presence === "busy"
                  ? "Matcher skips me"
                  : "Matcher skips me"}
            </div>
          ) : null}
          {/* Mute toggle — sits beside the label so it's reachable
              one-click while the ringtone is going. */}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute ringtone" : "Mute ringtone"}
            title={muted ? "Ringtone muted — click to unmute" : "Mute ringtone"}
            className="mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{
              borderColor: "var(--border)",
              color: muted ? "var(--accent-red)" : "var(--text-muted)",
            }}
          >
            {muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
            {muted ? "Sound muted" : "Sound on"}
          </button>
        </div>
      )}

      {menuOpen && (
        <div
          role="menu"
          className="absolute z-40 min-w-[220px] overflow-hidden rounded-xl border shadow-xl"
          style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--border)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
            // Collapsed sidebar (60 px) → expand menu to the right of the
            // ball; otherwise drop down beneath the row.
            top: collapsed ? "0" : "100%",
            left: collapsed ? "100%" : "50%",
            transform: collapsed ? "none" : "translateX(-50%)",
            marginTop: collapsed ? 0 : 6,
            marginLeft: collapsed ? 8 : 0,
          }}
        >
          {(["online", "busy", "offline"] as const).map((v) => {
            const m = COLOURS[v];
            const isActive = presence === v;
            const blurb = v === "online"
              ? "Matcher rings me — instant call"
              : v === "busy"
                ? "Matcher skips me — customer can request"
                : "Matcher skips me — customer schedules ahead";
            return (
              <button
                key={v}
                type="button"
                role="menuitem"
                onClick={() => void onSet(v)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span
                  className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: m.fill }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                      {m.label}
                    </span>
                    {isActive && <Check size={11} style={{ color: m.fill }} />}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {blurb}
                  </div>
                </div>
              </button>
            );
          })}
          {/* Mute toggle accessible inside the menu too, in case the
              ringtone fires while the sidebar is collapsed. */}
          <button
            type="button"
            onClick={() => { toggleMute(); }}
            className="flex w-full items-center gap-2.5 border-t px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "var(--border)" }}
          >
            {muted
              ? <VolumeX size={13} style={{ color: "var(--text-muted)" }} />
              : <Volume2 size={13} style={{ color: "var(--text-muted)" }} />}
            <span className="text-[12px]" style={{ color: "var(--text)" }}>
              {muted ? "Unmute ringtone" : "Mute ringtone"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Ringtone — synthesized via Web Audio API so we don't need an audio
//     asset bundled. Two-tone alternating beep over ~1.2 seconds; soft
//     volume so it doesn't startle. No-op when muted.
function playRingtone(muted: boolean) {
  if (muted) return;
  if (typeof window === "undefined") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx: AudioContext = new Ctor();
    const now = ctx.currentTime;
    const playBeep = (start: number, hz: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, now + start);
      // ADSR envelope so beeps fade in/out softly.
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.08, now + start + 0.02);
      gain.gain.setValueAtTime(0.08, now + start + dur - 0.05);
      gain.gain.linearRampToValueAtTime(0, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };
    // Two-tone pattern: high-low-high, three beats.
    playBeep(0,    880, 0.25);
    playBeep(0.30, 660, 0.25);
    playBeep(0.60, 880, 0.25);
    // Close the context after the pattern finishes so we don't pile up
    // dangling AudioContexts across multiple incoming calls.
    setTimeout(() => { ctx.close().catch(() => { /* already closing */ }); }, 1200);
  } catch (err) {
    console.warn("[presence-ball] ringtone failed:", err);
  }
}
