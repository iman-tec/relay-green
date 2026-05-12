"use client";

/*
 * Customer room — claude.ai-style layout.
 *
 * Left sidebar (260px, persistent): wordmark + "New session" + search +
 * recents + profile chip at the bottom.
 *
 * Main pane is state-driven:
 *   no session / cancelled / abandoned / queued / assigned / joining
 *       → ChatPane full width  (the universal "landing" — composer auto-creates a session)
 *       → overlays: ConnectingModal (while queued), IncomingCallModal (when engineer in Zoom)
 *
 *   live (both joined)      → ZoomEmbed (66%, centre)   |   ChatPane (34%, right)
 *
 *   ended                   → PostCallView (locked chat + AI summary)
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PanelGroup, Panel, PanelResizeHandle,
} from "react-resizable-panels";
import {
  Plus, Send, Sparkles, Video, Phone, X, PhoneOff, MessageSquare, Lock,
  AlertTriangle, Loader2, ChevronDown, Search, PanelLeftClose, PanelLeftOpen,
  Wallet, RefreshCw, Settings, LogOut, Check,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { ZoomEmbed } from "@/app/_components/ZoomEmbed";
import { PopOutContainer } from "@/app/_components/PopOutContainer";
import { PaywallModal } from "@/app/_components/PaywallModal";
import { useCustomerSession } from "@/lib/relay/useCustomerSession";
import { useSessionTimer } from "@/lib/relay/useSessionTimer";
import { createClient } from "@/lib/supabase/browser";
import type { GuestCall, GuestMessage, SessionStatus, Urgency } from "@/lib/supabase/types";

const BRAND_GREEN       = "#3f5c2e";
const BRAND_GREEN_SOFT  = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";
const URGENT_AMBER      = "#c66645";
const URGENT_AMBER_SOFT = "rgba(198, 102, 69, 0.14)";
const CRIT_RED          = "#c8553d";
const CRIT_RED_SOFT     = "rgba(200, 85, 61, 0.18)";

// ── Main ───────────────────────────────────────────────────────────────────
export function RoomClient() {
  const router = useRouter();
  const state  = useCustomerSession();
  const timer  = useSessionTimer(state.session?.joined_at ?? null, state.session?.free_minutes ?? 10);

  // Local: customer accepted the incoming call but hasn't completed Zoom
  // join yet. We use this to mount the split layout immediately so the
  // ZoomEmbed gets a place to render. After the embed fires `onJoined`,
  // mark_joined() flips the session to 'live' and the flag is no longer
  // needed (but harmless to keep on).
  const [accepted, setAccepted] = useState(false);

  // The customer can click a past-session row in the sidebar to review it.
  // When set, we render the split layout with chat + summary for that row.
  const [viewingPastId, setViewingPastId] = useState<string | null>(null);

  // Connecting modal: only show once per session id (not on reload).
  const showConnecting = useConnectingModalGate(state.session?.id ?? null, state.session?.status);

  // Paywall opens when:
  //   - session is in expired_free state (live cap hit, buffer ticking)
  //   - session ended for free_session_expired with no paid credit
  //   - composer attempts a new session but no entitlement (manual trigger)
  const [paywallOpen, setPaywallOpen] = useState<null | "free_expired" | "no_credits" | "manual">(null);
  const [paidToast, setPaidToast] = useState<string | null>(null);
  useEffect(() => {
    if (state.session?.status === "expired_free") {
      setPaywallOpen("free_expired");
      return;
    }
    if (
      state.session?.status === "ended" &&
      state.session.ended_reason === "free_session_expired" &&
      state.entitlement.paid_minutes_remaining <= 0
    ) {
      setPaywallOpen("free_expired");
    }
  }, [state.session?.status, state.session?.ended_reason, state.entitlement.paid_minutes_remaining]);

  // If the RPC returned NO_ENTITLEMENT, pop paywall.
  useEffect(() => {
    if (state.error === "NO_ENTITLEMENT") {
      setPaywallOpen("no_credits");
    }
  }, [state.error]);

  // Stripe success handshake: when the user lands back from Checkout with
  // ?relay_paid=base|pro|max in the URL, refetch entitlements so the new
  // minutes show up on the profile chip + paywall auto-dismisses.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const paid = q.get("relay_paid");
    if (paid && paid !== "cancelled") {
      setPaywallOpen(null);
      setPaidToast(`Payment received — your ${paid} plan is active.`);
      // The webhook is async; give it a couple of seconds, then refresh.
      const t = setTimeout(() => { void state.refresh(); }, 2500);
      const t2 = setTimeout(() => setPaidToast(null), 5000);
      // Clean up the URL so a reload doesn't retrigger this branch
      const url = new URL(window.location.href);
      url.searchParams.delete("relay_paid");
      window.history.replaceState({}, "", url.toString());
      return () => { clearTimeout(t); clearTimeout(t2); };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the flag whenever we leave the call (session ends or a new one starts)
  useEffect(() => {
    if (!state.session || state.session.status === "ended" || state.session.status === "queued") {
      setAccepted(false);
    }
  }, [state.session?.id, state.session?.status]);

  // Clear past-session preview as soon as the customer starts a new session
  useEffect(() => {
    if (state.session && !["ended","cancelled","abandoned"].includes(state.session.status)) {
      // active session — close any past preview
      // (but leave it open if they end this one and want to keep reviewing the old one)
    }
  }, [state.session?.status]);

  useEffect(() => {
    if (state.auth.kind === "anonymous") router.replace("/login");
  }, [state.auth.kind, router]);

  // Free-session lifecycle:
  //   1. live ─10 min, no paid credit─▶ expire_to_free (paywall opens)
  //   2. live ─10 min, paid credit ok─▶ silently switch to paid time
  //   3. expired_free ─10 min, no payment─▶ end_session(reason=buffer_expired)
  //
  // All RPCs are idempotent — multiple clients can fire safely.
  const s = state.session;
  useEffect(() => {
    if (!s) return;
    const sb = createClient();
    const hasPaid = state.entitlement.paid_minutes_remaining > 0;

    if (s.status === "live" && timer.isExpired) {
      if (hasPaid) {
        // Customer has paid credit — silently switch billing mode by stamping
        // paid_extension_at. The clock keeps running on the engineer side too.
        if (!s.paid_extension_at) {
          void sb.from("guest_calls").update({ paid_extension_at: new Date().toISOString() }).eq("id", s.id);
        }
        return;
      }
      // No paid credit → expire to the free-cap state, paywall opens
      void sb.rpc("expire_to_free", { _session_id: s.id });
      return;
    }

    // Buffer watchdog: if we've been in expired_free for 10 min, force-end.
    if (s.status === "expired_free" && s.free_expired_at) {
      const elapsedMs = Date.now() - new Date(s.free_expired_at).getTime();
      if (elapsedMs >= 10 * 60_000) {
        void (async () => {
          await sb.rpc("end_session", { _session_id: s.id, _reason: "payment_buffer_expired" });
          void sb.functions.invoke("summarize-guest-call", { body: { guest_call_id: s.id } });
        })();
      }
    }
  }, [s?.id, s?.status, s?.free_expired_at, s?.paid_extension_at, timer.isExpired, state.entitlement.paid_minutes_remaining]);

  // Tick every second while in expired_free so the buffer watchdog re-evaluates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (s?.status !== "expired_free") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [s?.status]);

  if (state.auth.kind === "loading" || state.loading) return <FullScreenLoader />;
  if (state.auth.kind === "anonymous") return null;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
    >
      <Sidebar
        email={state.auth.kind === "authed" ? state.auth.email : ""}
        customerUserId={state.auth.kind === "authed" ? state.auth.userId : null}
        session={state.session}
        entitlement={state.entitlement}
        viewingPastId={viewingPastId}
        onViewPast={setViewingPastId}
        onNewSession={async () => {
          // Entitlement-aware: if neither free nor paid, open the paywall
          // directly instead of round-tripping to the RPC that would just raise.
          const hasFreeLeft = !state.entitlement.free_consumed_at;
          const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
          if (!hasFreeLeft && !hasPaidLeft) {
            setPaywallOpen("no_credits");
            return;
          }
          setViewingPastId(null);
          await state.startNewSession();
        }}
        onWalletClick={() => {
          const hasFreeLeft = !state.entitlement.free_consumed_at;
          const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
          if (!hasFreeLeft && !hasPaidLeft) setPaywallOpen("no_credits");
        }}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating status / timer chip + end-meeting button (top-right) */}
        <FloatingStatus
          session={state.session}
          timer={timer}
          accepted={accepted}
          onEnd={state.end}
        />

        <main className="min-h-0 flex-1">
          <MainPane
            state={state}
            accepted={accepted}
            viewingPastId={viewingPastId}
            onCloseViewPast={() => setViewingPastId(null)}
            onNeedsCredits={() => setPaywallOpen("no_credits")}
          />
        </main>
      </div>

      {/* Overlays */}
      {state.session?.status === "queued" && showConnecting && (
        <ConnectingModal session={state.session} onRecall={state.recall} onCancel={state.cancel} />
      )}
      {state.session && shouldShowEngineerAssigned(state.session) && !accepted && (
        <EngineerAssignedModal
          engineerName={state.session.agent_name ?? "Your engineer"}
          onCancel={state.cancel}
        />
      )}
      {state.session && shouldShowIncomingCall(state.session) && !accepted && (
        <IncomingCallModal
          engineerName={state.session.agent_name ?? "Your engineer"}
          onAccept={() => {
            // Mark joined immediately on accept so the session flips to 'live'
            // even if the Zoom embed is slow or blocked. mark_joined is
            // idempotent — Zoom's onJoined firing later is a no-op.
            setAccepted(true);
            void state.markJoined();
          }}
        />
      )}
      {state.error && state.error !== "NO_ENTITLEMENT" && <ErrorToast message={state.error} />}
      {paidToast && <SuccessToast message={paidToast} />}

      <PaywallModal
        open={paywallOpen !== null}
        reason={paywallOpen ?? "manual"}
        onClose={() => setPaywallOpen(null)}
      />
    </div>
  );
}

// ── State helpers ──────────────────────────────────────────────────────────
function shouldShowIncomingCall(s: GuestCall): boolean {
  return (
    !!s.engineer_joined_at && !!s.zoom_meeting_id &&
    !s.customer_joined_at &&
    ["joining","live"].includes(s.status)
  );
}

// Engineer has accepted the request (assigned) but hasn't started video yet.
// We show a "Engineer found — connecting your call" card so the customer
// isn't left with the queue's avg-wait timer ticking after the request was
// already picked up. Dismissed automatically once the engineer joins the
// Zoom meeting (engineer_joined_at stamped → IncomingCallModal takes over).
function shouldShowEngineerAssigned(s: GuestCall): boolean {
  return (
    s.status === "assigned" &&
    !s.engineer_joined_at &&
    !s.customer_joined_at
  );
}

// Returns true the FIRST time we want to show the connecting modal for a
// given session id (in this browser tab). Reloads don't re-trigger.
function useConnectingModalGate(sessionId: string | null, status: string | undefined): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!sessionId || status !== "queued") {
      setShow(false);
      return;
    }
    if (typeof window === "undefined") return;
    const key = `relay-connecting-shown:${sessionId}`;
    try {
      if (sessionStorage.getItem(key)) {
        setShow(false);
        return;
      }
      sessionStorage.setItem(key, "1");
      setShow(true);
    } catch {
      setShow(true);
    }
  }, [sessionId, status]);
  return show;
}

function isLiveWithCustomerJoined(s: GuestCall | null): boolean {
  return !!s?.customer_joined_at && !!s.zoom_meeting_id && s.status === "live";
}

// True the moment the customer accepts the incoming-call modal (local
// state) OR the server has already stamped customer_joined_at.
function shouldRenderSplitLayout(s: GuestCall | null, accepted: boolean): boolean {
  if (!s || !s.zoom_meeting_id) return false;
  if (isLiveWithCustomerJoined(s)) return true;
  // Engineer is in the Zoom room AND the customer clicked Accept locally.
  if (accepted && !!s.engineer_joined_at && ["joining", "live"].includes(s.status)) return true;
  return false;
}

// ── Main pane (state-driven) ───────────────────────────────────────────────
function MainPane({
  state, accepted, viewingPastId, onCloseViewPast, onNeedsCredits,
}: {
  state: ReturnType<typeof useCustomerSession>;
  accepted: boolean;
  viewingPastId: string | null;
  onCloseViewPast: () => void;
  onNeedsCredits: () => void;
}) {
  const session = state.session;

  // Active call: Zoom (centre) | chat (right). Mount as soon as the customer
  // accepts the incoming call — the embed itself takes a beat to load.
  if (shouldRenderSplitLayout(session, accepted)) {
    return (
      <PanelGroup direction="horizontal" autoSaveId="relay-room-live" className="h-full">
        <Panel defaultSize={66} minSize={40} order={1}>
          <CustomerZoomPane
            session={session!}
            userName={fmtName(state.auth)}
            userEmail={emailOf(state.auth)}
            onJoined={state.markJoined}
          />
        </Panel>
        <Resizer />
        <Panel defaultSize={34} minSize={22} order={2}>
          <ChatPane state={state} />
        </Panel>
      </PanelGroup>
    );
  }

  // User clicked a past session in the sidebar — show its review on the right
  if (viewingPastId) {
    return (
      <PanelGroup direction="horizontal" autoSaveId="relay-room-review" className="h-full">
        <Panel defaultSize={60} minSize={40} order={1}>
          <ChatPane state={state} fullWidth onNeedsCredits={onNeedsCredits} />
        </Panel>
        <Resizer />
        <Panel defaultSize={40} minSize={28} order={2}>
          <PastSessionReview sessionId={viewingPastId} onClose={onCloseViewPast} />
        </Panel>
      </PanelGroup>
    );
  }

  // Just-ended session: same split, showing the in-memory session/messages
  if (session?.status === "ended") {
    return (
      <PanelGroup direction="horizontal" autoSaveId="relay-room-review" className="h-full">
        <Panel defaultSize={60} minSize={40} order={1}>
          <ChatPane state={state} fullWidth onNeedsCredits={onNeedsCredits} />
        </Panel>
        <Resizer />
        <Panel defaultSize={40} minSize={28} order={2}>
          <ReviewPanel session={session} messages={state.messages} onClose={undefined} />
        </Panel>
      </PanelGroup>
    );
  }

  // Everything else renders the welcome / chat landing. The composer's
  // send handler auto-creates a new session if the current one is terminal.
  return <ChatPane state={state} fullWidth onNeedsCredits={onNeedsCredits} />;
}

// Loads a past session's row + messages on demand for the review panel.
function PastSessionReview({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [row, setRow] = useState<GuestCall | null>(null);
  const [msgs, setMsgs] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const sb = createClient();
      const [{ data: r }, { data: m }] = await Promise.all([
        sb.from("guest_calls").select("*").eq("id", sessionId).maybeSingle(),
        sb.from("guest_messages").select("*").eq("guest_call_id", sessionId).order("created_at"),
      ]);
      if (cancelled) return;
      setRow((r as GuestCall | null) ?? null);
      setMsgs(((m ?? []) as GuestMessage[]));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (loading || !row) {
    return (
      <section className="flex h-full items-center justify-center border-l"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
        <Loader2 size={18} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </section>
    );
  }
  return <ReviewPanel session={row} messages={msgs} onClose={onClose} />;
}

function fmtName(auth: ReturnType<typeof useCustomerSession>["auth"]) {
  if (auth.kind === "authed") return auth.email.split("@")[0] || "Customer";
  return "Customer";
}
function emailOf(auth: ReturnType<typeof useCustomerSession>["auth"]) {
  return auth.kind === "authed" ? auth.email : null;
}

// ── Floating status chip (top-right) ───────────────────────────────────────
function FloatingStatus({
  session, timer, accepted, onEnd,
}: {
  session: GuestCall | null;
  timer: ReturnType<typeof useSessionTimer>;
  accepted: boolean;
  onEnd: (reason?: string) => Promise<void>;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Hide entirely when there's nothing useful to show (idle, no session)
  const showTimer  = session?.status === "live";
  const showStatus = !!session && !["ended","cancelled","abandoned"].includes(session.status);
  // End button: visible whenever the customer is in (or accepted) an active call
  const showEnd = !!session && (
    session.status === "live" ||
    (accepted && ["joining", "live"].includes(session.status))
  );
  if (!showTimer && !showStatus && !showEnd) return null;

  return (
    <>
      <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-2">
        {showTimer && (
          <div className="pointer-events-auto">
            <TimerPill warning={timer.isWarning} expired={timer.isExpired} formatRemaining={timer.formatRemaining} />
          </div>
        )}
        {showStatus && session && (
          <div className="pointer-events-auto">
            <StatusPill session={session} />
          </div>
        )}
        {showEnd && (
          <button
            onClick={() => setConfirmEnd(true)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:opacity-90"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
              color: "var(--accent-red)",
            }}
          >
            <PhoneOff size={11} />
            End
          </button>
        )}
      </div>

      {confirmEnd && (
        <ConfirmEndModal
          onCancel={() => setConfirmEnd(false)}
          onConfirm={async () => { setConfirmEnd(false); await onEnd(); }}
        />
      )}
    </>
  );
}

function ConfirmEndModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border p-7 text-center shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            backgroundColor: "color-mix(in srgb, var(--accent-red) 12%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          <PhoneOff size={20} />
        </div>
        <h2
          className="mb-2 text-lg font-medium"
          style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}
        >
          End this session?
        </h2>
        <p className="mb-6 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          The video call will close and we&apos;ll generate a summary. You can&apos;t resume after ending.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full border py-2.5 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Cancel
          </button>
          <button
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            disabled={busy}
            className="flex-1 rounded-full py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "var(--accent-red)", color: "#fff" }}
          >
            {busy ? <Loader2 size={14} className="animate-spin inline" /> : "End session"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TimerPill({ warning, expired, formatRemaining }: { warning: boolean; expired: boolean; formatRemaining: string }) {
  const cfg = expired
    ? { bg: CRIT_RED_SOFT, fg: CRIT_RED, label: "Free expired" }
    : warning
    ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, label: `${formatRemaining} left` }
    : { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN, label: `${formatRemaining} free` };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      {cfg.label}
    </span>
  );
}

function StatusPill({ session }: { session: GuestCall }) {
  const cfg = pillConfig(session.status, session.urgency);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}
    >
      <span className="relative flex h-2 w-2">
        {cfg.pulse && (
          <span className="absolute inset-0 rounded-full opacity-70"
            style={{ backgroundColor: cfg.fg, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }} />
        )}
        <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: cfg.fg }} />
      </span>
      {cfg.label}
    </span>
  );
}

function pillConfig(status: SessionStatus, urgency: Urgency) {
  if (status === "abandoned" || status === "cancelled") {
    return { label: "Closed", bg: "color-mix(in srgb, var(--text) 8%, transparent)", fg: "var(--text-muted)", pulse: false };
  }
  if (status === "ended") {
    return { label: "Ended", bg: "color-mix(in srgb, var(--text) 8%, transparent)", fg: "var(--text-muted)", pulse: false };
  }
  if (urgency === "critical") return { label: "Critical",        bg: CRIT_RED_SOFT,    fg: CRIT_RED,     pulse: true };
  if (urgency === "urgent")   return { label: "Urgent",          bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, pulse: true };
  if (status === "queued")    return { label: "Connecting",      bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "assigned")  return { label: "Engineer joining", bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN,  pulse: true };
  if (status === "joining")   return { label: "Connecting call", bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "live")      return { label: "Live",            bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "grace")     return { label: "Reconnecting",    bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, pulse: true };
  if (status === "ending")    return { label: "Wrapping up",     bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  return { label: status,                                          bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: false };
}

// ── Sidebar (claude.ai style, collapsible) ────────────────────────────────
type PastSession = { id: string; title: string; agent: string | null; minutes: number | null; date: string };

function Sidebar({
  email, customerUserId, session, entitlement, viewingPastId, onViewPast, onNewSession, onWalletClick,
}: {
  email: string;
  customerUserId: string | null;
  session: GuestCall | null;
  entitlement: { free_consumed_at: string | null; free_minutes_used: number; paid_minutes_remaining: number };
  viewingPastId: string | null;
  onViewPast: (id: string | null) => void;
  onNewSession: () => Promise<void>;
  onWalletClick: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [past, setPast] = useState<PastSession[]>([]);

  useEffect(() => {
    if (!customerUserId) return;
    const sb = createClient();
    void (async () => {
      const { data } = await sb
        .from("guest_calls")
        .select("id, guest_name, agent_name, duration_minutes, ai_summary_title, created_at, status")
        .eq("customer_user_id", customerUserId)
        .in("status", ["ended"])
        .order("created_at", { ascending: false })
        .limit(30);
      setPast((data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.id as string,
          title: (row.ai_summary_title as string | null) ?? "Past session",
          agent: row.agent_name as string | null,
          minutes: row.duration_minutes != null ? Math.round(Number(row.duration_minutes)) : null,
          date: row.created_at as string,
        };
      }));
    })();
  }, [customerUserId, session?.id, session?.status]);

  const buckets = useMemo(() => groupByDate(past), [past]);

  const hasActiveSession = session && !["ended", "cancelled", "abandoned"].includes(session.status);

  // ── Collapsed state: icon-only rail ──────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="flex h-full w-12 shrink-0 flex-col items-center py-2"
        style={{ borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
      >
        {/* Expand toggle */}
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelLeftOpen size={18} />
        </button>

        {/* New session */}
        <button
          onClick={() => void onNewSession()}
          title="New session"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: BRAND_GREEN }}
        >
          <Plus size={18} />
        </button>

        {/* Search */}
        <button
          title="Search"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <Search size={16} />
        </button>

        {/* Sessions */}
        <button
          title="Sessions"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <MessageSquare size={16} />
        </button>

        {/* Active session indicator */}
        {hasActiveSession && (
          <button
            onClick={() => onViewPast(null)}
            title="Current session"
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
            style={{ color: BRAND_GREEN }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full opacity-70"
                style={{ backgroundColor: BRAND_GREEN, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }} />
              <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
            </span>
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Profile avatar — opens user menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            title={email.split("@")[0]}
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {(email || "?")[0]}
            </div>
          </button>
          {userMenuOpen && (
            <UserMenu
              email={email}
              entitlement={entitlement}
              onRecharge={() => { setUserMenuOpen(false); onWalletClick(); }}
              onClose={() => setUserMenuOpen(false)}
              collapsed
            />
          )}
        </div>
      </aside>
    );
  }

  // ── Expanded state ────────────────────────────────────────────────────────
  return (
    <aside
      className="flex h-full w-[260px] shrink-0 flex-col"
      style={{ borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Brand row + collapse toggle */}
      <div className="flex h-12 items-center justify-between px-3">
        <Wordmark size="md" />
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* New session + Search */}
      <div className="px-2 py-1">
        <button
          onClick={() => void onNewSession()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text)" }}
        >
          <Plus size={16} style={{ color: BRAND_GREEN }} />
          New session
        </button>
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <Search size={15} />
          Search
        </button>
      </div>

      {/* Recents */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-3">
        <div className="mb-1 flex items-center justify-between px-2.5 py-1">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            Recents
          </span>
        </div>

        {hasActiveSession && (
          <button
            onClick={() => onViewPast(null)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors"
            style={{ backgroundColor: BRAND_GREEN_SOFT, border: `1px solid ${BRAND_GREEN_BORDER}` }}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 rounded-full opacity-70"
                style={{ backgroundColor: BRAND_GREEN, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }} />
              <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                Current session
              </div>
              <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                {humanState(session.status)}
              </div>
            </div>
          </button>
        )}

        {buckets.map(([label, items]) => items.length === 0 ? null : (
          <div key={label} className="mt-3">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {label}
            </div>
            <div className="space-y-0.5">
              {items.map((s) => {
                const isSelected = viewingPastId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => onViewPast(isSelected ? null : s.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={isSelected
                      ? { backgroundColor: BRAND_GREEN_SOFT, border: `1px solid ${BRAND_GREEN_BORDER}` }
                      : undefined}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: isSelected ? BRAND_GREEN : "var(--text-muted)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: "var(--text)" }}>
                        {s.title}
                      </div>
                      <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {s.agent ?? "Engineer"}
                        {s.minutes != null ? ` · ${s.minutes}m` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {past.length === 0 && (
          <p className="px-2 py-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Your past sessions will appear here.
          </p>
        )}
      </div>

      {/* Profile (bottom) */}
      <div className="relative border-t p-2" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {(email || "?")[0]}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-[12px] font-medium" style={{ color: "var(--text)" }}>
              {email.split("@")[0]}
            </div>
            <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
              {formatEntitlement(entitlement)}
            </div>
          </div>
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
        </button>
        {userMenuOpen && (
          <UserMenu
            email={email}
            entitlement={entitlement}
            onRecharge={() => { setUserMenuOpen(false); onWalletClick(); }}
            onClose={() => setUserMenuOpen(false)}
          />
        )}
      </div>
    </aside>
  );
}

function formatEntitlement(e: { free_consumed_at: string | null; free_minutes_used: number; paid_minutes_remaining: number }): string {
  if (e.paid_minutes_remaining > 0) {
    const m = Math.floor(e.paid_minutes_remaining);
    return `${m} min paid`;
  }
  if (e.free_consumed_at) return "Free used · upgrade to continue";
  return "10 min free available";
}

function planLabel(e: { free_consumed_at: string | null; paid_minutes_remaining: number }): string {
  if (e.paid_minutes_remaining > 0) return "Paid plan";
  return "Free plan";
}

// ── User menu dropdown (Claude-style) ─────────────────────────────────────
function UserMenu({
  email, entitlement, onRecharge, onClose, collapsed = false,
}: {
  email: string;
  entitlement: { free_consumed_at: string | null; free_minutes_used: number; paid_minutes_remaining: number };
  onRecharge: () => void;
  onClose: () => void;
  collapsed?: boolean;
}) {
  const router = useRouter();

  const handleLogout = async () => {
    const sb = createClient();
    await sb.auth.signOut();
    router.push("/login");
  };

  const menuItems = [
    {
      icon: <Settings size={15} />,
      label: "Settings",
      onClick: () => { onClose(); router.push("/settings"); },
    },
    {
      icon: <LogOut size={15} />,
      label: "Log out",
      onClick: () => void handleLogout(),
      danger: true,
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Menu panel */}
      <div
        className="absolute z-50 w-64 rounded-xl border shadow-xl"
        style={{
          bottom: "calc(100% + 8px)",
          left: collapsed ? "48px" : "0px",
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        {/* Email header */}
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
            {email}
          </p>
        </div>

        {/* Plan + wallet */}
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between rounded-lg px-1 py-2">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
                style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
              >
                {(email || "?")[0]}
              </div>
              <div>
                <div className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                  {email.split("@")[0]}
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {planLabel(entitlement)}
                </div>
              </div>
            </div>
            <Check size={14} style={{ color: BRAND_GREEN }} />
          </div>

          {/* Wallet balance row */}
          <div
            className="mt-1 flex items-center justify-between rounded-lg px-2 py-2"
            style={{ backgroundColor: BRAND_GREEN_SOFT }}
          >
            <div className="flex items-center gap-2">
              <Wallet size={14} style={{ color: BRAND_GREEN }} />
              <div>
                <div className="text-[12px] font-medium" style={{ color: "var(--text)" }}>
                  Wallet
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {formatEntitlement(entitlement)}
                </div>
              </div>
            </div>
            <button
              onClick={onRecharge}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              <RefreshCw size={10} />
              Recharge
            </button>
          </div>
        </div>

        {/* Menu items */}
        <div className="px-2 py-1.5">
          {menuItems.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: item.danger ? "#e05c4b" : "var(--text)" }}
            >
              <span style={{ color: item.danger ? "#e05c4b" : "var(--text-muted)" }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function humanState(s: SessionStatus): string {
  switch (s) {
    case "queued":       return "Connecting…";
    case "assigned":     return "Engineer joining";
    case "joining":      return "Connecting call";
    case "live":         return "Live now";
    case "grace":        return "Reconnecting";
    case "ending":       return "Wrapping up";
    case "ended":        return "Ended";
    case "abandoned":    return "No engineer found";
    case "cancelled":    return "Cancelled";
    case "expired_free": return "Free session ended";
  }
}

function groupByDate(past: PastSession[]): Array<[string, PastSession[]]> {
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const buckets: Record<string, PastSession[]> = { "Today": [], "Yesterday": [], "Previous 7 Days": [], "Older": [] };
  for (const s of past) {
    const d = new Date(s.date);
    if (d >= today) buckets.Today.push(s);
    else if (d >= yesterday) buckets.Yesterday.push(s);
    else if (d >= sevenDaysAgo) buckets["Previous 7 Days"].push(s);
    else buckets.Older.push(s);
  }
  return Object.entries(buckets);
}

// ── Chat pane ──────────────────────────────────────────────────────────────
function ChatPane({
  state, fullWidth = false, onNeedsCredits,
}: {
  state: ReturnType<typeof useCustomerSession>;
  fullWidth?: boolean;
  onNeedsCredits?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const session = state.session;
  // Only `ended` is truly read-only (post-call view). cancelled / abandoned
  // are equivalent to "no session" — the composer auto-creates a new queued
  // session when the user types.
  const isReadOnly = session?.status === "ended";

  const onSend = async () => {
    if (!draft.trim()) return;
    // If the customer would be starting a NEW session here AND they have
    // no entitlement left → block + show paywall instead.
    const wouldCreateNew = !session || ["cancelled", "abandoned", "ended"].includes(session.status);
    const hasFreeLeft = !state.entitlement.free_consumed_at;
    const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
    if (wouldCreateNew && !hasFreeLeft && !hasPaidLeft && onNeedsCredits) {
      onNeedsCredits();
      return;
    }
    const text = draft.trim();
    setDraft("");
    await state.sendOrStart(text);
  };

  const maxWidth = fullWidth ? "max-w-3xl" : "max-w-none";

  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className={`mx-auto w-full ${maxWidth}`}>
          {state.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-2 py-20 text-center">
              <div className="mb-5 flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                <h2
                  className="text-3xl font-semibold tracking-tight sm:text-[40px]"
                  style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
                >
                  How can we help today?
                </h2>
              </div>
              <p className="max-w-md text-base" style={{ color: "var(--text-muted)" }}>
                Type what you&apos;re stuck on — an engineer joins in seconds.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {state.messages.map((m) => <Message key={m.id} message={m} />)}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="px-4 pb-6 pt-2">
        <div className={`mx-auto w-full ${maxWidth}`}>
          <div
            className="relative rounded-2xl border shadow-sm transition-all focus-within:ring-2"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              ["--tw-ring-color" as string]: BRAND_GREEN_BORDER,
              opacity: isReadOnly ? 0.55 : 1,
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              disabled={isReadOnly}
              placeholder={isReadOnly ? "This session has ended" : "Describe what you're working on…"}
              className="h-12 w-full rounded-2xl bg-transparent pl-4 pr-12 text-sm outline-none disabled:cursor-not-allowed"
              style={{ color: "var(--text)" }}
            />
            <button
              onClick={() => void onSend()}
              disabled={isReadOnly || !draft.trim()}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl disabled:opacity-40"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              <Send size={14} />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </section>
  );
}

function Message({ message }: { message: GuestMessage }) {
  if (message.sender_kind === "system") {
    return (
      <div className="flex justify-center">
        <span className="inline-block rounded-full px-2.5 py-1 text-[11px]"
          style={{ backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text-muted)" }}>
          {message.body}
        </span>
      </div>
    );
  }
  const mine = message.sender_kind === "guest";
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="mb-0.5 px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {message.sender_name ?? (mine ? "You" : "Engineer")}
      </div>
      <div
        className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap"
        style={
          mine
            ? { backgroundColor: BRAND_GREEN, color: "#fff", borderBottomRightRadius: 4 }
            : { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text)", borderBottomLeftRadius: 4 }
        }
      >
        {message.body}
      </div>
    </div>
  );
}

// ── Customer Zoom pane (the parent decides when to render this) ────────────
function CustomerZoomPane({
  session, userName, userEmail, onJoined,
}: {
  session: GuestCall;
  userName: string;
  userEmail: string | null;
  onJoined: () => Promise<void>;
}) {
  if (!session.zoom_meeting_id) {
    return (
      <section className="flex h-full items-center justify-center" style={{ backgroundColor: "#0a0a0a" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </section>
    );
  }
  return (
    <section className="relative h-full" style={{ backgroundColor: "#000" }}>
      <PopOutContainer title="Relay session — customer">
        <ZoomEmbed
          meetingNumber={session.zoom_meeting_id}
          userName={userName}
          userEmail={userEmail}
          role={0}
          fallbackJoinUrl={session.zoom_join_url}
          onJoined={() => void onJoined()}
        />
      </PopOutContainer>
    </section>
  );
}

// ── Review panel (post-ended: summary + chat history with pill tabs) ───────
function ReviewPanel({
  session, messages, onClose,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<"summary" | "chat">("summary");
  const messageCount = messages.filter((m) => m.sender_kind !== "system").length;

  return (
    <section
      className="flex h-full flex-col border-l"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Pill tab switcher + optional close */}
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <PillTab active={tab === "summary"} onClick={() => setTab("summary")}>
          <Sparkles size={11} />
          Summary
        </PillTab>
        <PillTab active={tab === "chat"} onClick={() => setTab("chat")}>
          <MessageSquare size={11} />
          Chat history
          <span
            className="ml-1 rounded-full px-1.5 py-0 text-[9px] font-semibold tabular-nums"
            style={{
              backgroundColor: tab === "chat" ? "rgba(255,255,255,0.18)" : "color-mix(in srgb, var(--text) 10%, transparent)",
              color: tab === "chat" ? "#fff" : "var(--text-muted)",
            }}
          >
            {messageCount}
          </span>
        </PillTab>
        <div className="flex-1" />
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close review"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {tab === "summary" ? (
        <SummaryView session={session} />
      ) : (
        <ChatHistoryView messages={messages} />
      )}
    </section>
  );
}

function PillTab({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
      style={
        active
          ? { backgroundColor: BRAND_GREEN, color: "#fff" }
          : { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text-muted)" }
      }
    >
      {children}
    </button>
  );
}

function SummaryView({ session }: { session: GuestCall }) {
  const title = session.ai_summary_title;
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];
  const generating = !overview && session.status === "ended";
  const dur = session.duration_minutes != null ? Math.round(Number(session.duration_minutes)) : 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      {/* Session meta */}
      <div className="mb-4 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <Lock size={11} />
        <span>Session ended</span>
        {dur > 0 && <span>· {dur} min</span>}
      </div>

      {generating ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Generating summary…
          </p>
        </div>
      ) : !overview ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No summary available.
        </p>
      ) : (
        <div className="space-y-5">
          {title && (
            <h2
              className="text-xl font-medium"
              style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)", letterSpacing: "-0.01em" }}
            >
              {title}
            </h2>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--text)" }}>
            {overview}
          </p>
          {nextSteps.length > 0 && (
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Next steps
              </h3>
              <ul className="space-y-1.5">
                {nextSteps.map((s, i) => {
                  const text = typeof s === "string" ? s : (s.text ?? s.description ?? "");
                  return (
                    <li key={i} className="flex gap-2 text-sm" style={{ color: "var(--text)" }}>
                      <span style={{ color: BRAND_GREEN }}>→</span>
                      <span>{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatHistoryView({ messages }: { messages: GuestMessage[] }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No messages exchanged.
        </p>
      ) : (
        messages.map((m) => <Message key={m.id} message={m} />)
      )}
    </div>
  );
}

// ── Resizer ────────────────────────────────────────────────────────────────
function Resizer() {
  return (
    <PanelResizeHandle
      className="group relative w-1.5 transition-colors hover:bg-[--green-soft]"
      style={
        { backgroundColor: "var(--border)", ["--green-soft" as string]: BRAND_GREEN_SOFT } as React.CSSProperties
      }
    />
  );
}

// ── Connecting Modal ───────────────────────────────────────────────────────
function ConnectingModal({
  session, onRecall, onCancel,
}: {
  session: GuestCall;
  onRecall: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const queuedAt = new Date(session.created_at).getTime();
  const [now, setNow] = useState(() => Date.now());
  const [recalling, setRecalling] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed   = Math.max(0, Math.floor((now - queuedAt) / 1000));
  const remaining = Math.max(0, 180 - elapsed);
  const mins = Math.floor(remaining / 60), secs = remaining % 60;
  const RADIUS = 46, CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - remaining / 180);
  const ringColor = session.urgency === "critical" ? CRIT_RED
    : session.urgency === "urgent" ? URGENT_AMBER
    : BRAND_GREEN;
  const ringSoft = session.urgency === "critical" ? CRIT_RED_SOFT
    : session.urgency === "urgent" ? URGENT_AMBER_SOFT
    : BRAND_GREEN_SOFT;
  const cooldownSeconds = (() => {
    if (!session.last_recall_at) return 0;
    return Math.max(0, 30 - Math.floor((now - new Date(session.last_recall_at).getTime()) / 1000));
  })();
  const handleRecall = async () => {
    setRecalling(true);
    try { await onRecall(); } finally { setRecalling(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}>
      <div className="relative w-full max-w-sm rounded-2xl border p-8 shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <button onClick={() => void onCancel()} aria-label="Close"
          className="absolute right-4 top-4 opacity-50 transition-opacity hover:opacity-100"
          style={{ color: "var(--text-muted)" }} title="Cancel">
          <X size={16} />
        </button>
        {session.urgency !== "normal" && (
          <div className="mb-4 flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ backgroundColor: ringSoft, color: ringColor }}>
            <AlertTriangle size={11} />
            {session.urgency === "critical" ? "Critical priority" : "Urgent priority"}
          </div>
        )}
        <div className="mb-5 flex justify-center">
          <div className="relative h-[120px] w-[120px]">
            <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
              <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="6" style={{ stroke: ringSoft }} />
              <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="6" strokeLinecap="round"
                style={{ stroke: ringColor, strokeDasharray: CIRC, strokeDashoffset: dashOffset, transition: "stroke-dashoffset 1s linear" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-3xl font-medium tabular-nums"
                style={{ fontFamily: "var(--font-source-serif)", color: ringColor }}>
                {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </div>
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--text-muted)" }}>
                Avg wait
              </div>
            </div>
          </div>
        </div>
        <div className="mb-2 text-center">
          <h2 className="mb-2 text-xl font-medium"
            style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}>
            Connecting you with the best engineer
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Hold tight — an engineer will be with you shortly.
          </p>
        </div>
        {session.recall_count > 0 && (
          <p className="mb-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
            Recalled {session.recall_count} {session.recall_count === 1 ? "time" : "times"}
            {session.urgency !== "normal" && (<> · marked <span style={{ color: ringColor, fontWeight: 600 }}>{session.urgency}</span></>)}
          </p>
        )}
        <button
          onClick={() => void handleRecall()}
          disabled={recalling || cooldownSeconds > 0 || session.recall_count >= 10}
          className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: ringColor, color: "#fff" }}
        >
          {recalling ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
          {cooldownSeconds > 0
            ? `Wait ${cooldownSeconds}s before recalling`
            : session.recall_count === 0 ? "Call for engineer" : "Recall engineer"}
        </button>
      </div>
    </div>
  );
}

// ── Engineer-assigned modal (engineer accepted the request) ────────────────
// Shows between engineer-accept (status='assigned') and engineer-joins-Zoom
// (engineer_joined_at stamped). No timer — the engineer is on it.
function EngineerAssignedModal({
  engineerName, onCancel,
}: {
  engineerName: string;
  onCancel: () => Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border p-8 text-center shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button
          onClick={() => void onCancel()}
          aria-label="Cancel"
          className="absolute right-4 top-4 opacity-50 transition-opacity hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>
        <div
          className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            backgroundColor: BRAND_GREEN_SOFT,
            color: BRAND_GREEN,
            animation: "relay-pulse 1.6s ease-out infinite",
          }}
        >
          <Sparkles size={28} />
        </div>
        <div
          className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--text-muted)" }}
        >
          Engineer found
        </div>
        <h2
          className="mb-2 text-xl font-medium"
          style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}
        >
          {engineerName} accepted your request
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Setting up your call — they&apos;ll ring you in a moment.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={11} className="animate-spin" style={{ color: BRAND_GREEN }} />
          Connecting…
        </div>
      </div>
      <style>{`
        @keyframes relay-pulse {
          0%   { transform: scale(1);    box-shadow: 0 0 0 0   rgba(63, 92, 46, 0.5); }
          70%  { transform: scale(1.04); box-shadow: 0 0 0 20px rgba(63, 92, 46, 0);   }
          100% { transform: scale(1);    box-shadow: 0 0 0 0   rgba(63, 92, 46, 0);   }
        }
      `}</style>
    </div>
  );
}

// ── Incoming-call modal (engineer joined Zoom) ─────────────────────────────
function IncomingCallModal({
  engineerName, onAccept,
}: {
  engineerName: string;
  onAccept: () => void;
}) {
  useEffect(() => {
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
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        osc.start(); osc.stop(ctx.currentTime + 0.45);
      };
      ring();
      iv = setInterval(ring, 1500);
    } catch { /* ignore */ }
    return () => {
      if (iv) clearInterval(iv);
      try { void ctx?.close(); } catch { /* ignore */ }
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}>
      <div className="relative w-full max-w-sm rounded-2xl border p-8 text-center shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN, animation: "relay-ring 1.4s ease-out infinite" }}>
          <Phone size={32} />
        </div>
        <h2 className="mb-2 text-xl font-medium"
          style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}>
          {engineerName} is calling
        </h2>
        <p className="mb-6 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Tap below to join the video call.
        </p>
        <button onClick={onAccept}
          className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}>
          <Video size={16} /> Join the call
        </button>
      </div>
      <style>{`
        @keyframes relay-ring {
          0%   { transform: scale(1);   box-shadow: 0 0 0 0   rgba(63, 92, 46, 0.6); }
          70%  { transform: scale(1.06);box-shadow: 0 0 0 28px rgba(63, 92, 46, 0);   }
          100% { transform: scale(1);   box-shadow: 0 0 0 0   rgba(63, 92, 46, 0);   }
        }
      `}</style>
    </div>
  );
}

// ── Misc ───────────────────────────────────────────────────────────────────
function FullScreenLoader() {
  return (
    <div className="flex h-screen w-screen items-center justify-center"
      style={{ backgroundColor: "var(--background)" }}>
      <Loader2 size={24} className="animate-spin" style={{ color: BRAND_GREEN }} />
    </div>
  );
}

function ErrorToast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
        color: "var(--accent-red)",
      }}>
      {message}
    </div>
  );
}

function SuccessToast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: BRAND_GREEN_BORDER,
        color: BRAND_GREEN,
      }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
      {message}
    </div>
  );
}
