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
 *       → overlays: ConnectingModal (while queued), EngineerAssignedModal until engineer joins Zoom (then auto-join)
 *
 *   live (both joined)      → ZoomEmbed (66%, centre)   |   ChatPane (34%, right)
 *
 *   ended                   → PostCallView (locked chat + AI summary)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PanelGroup, Panel, PanelResizeHandle,
} from "react-resizable-panels";
import {
  Plus, Send, Sparkles, Phone, X, PhoneOff, MessageSquare, Lock,
  AlertTriangle, Loader2, ChevronDown, ChevronRight, Search, PanelLeftClose, PanelLeftOpen,
  Wallet, RefreshCw, Settings, LogOut, Check, Folder,
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

// ── Free-session lifecycle hook ───────────────────────────────────────────
// Owns the 1-second tick needed to detect free-cap expiry + buffer-expiry,
// and fires the corresponding RPCs. Kept OUT of RoomClient's body so the
// per-second re-render scope is local to this hook — none of the sidebar /
// chat / zoom tree re-renders just because the timer ticked.
function useFreeSessionLifecycle(
  session: GuestCall | null,
  paidMinutesRemaining: number,
) {
  // `now` is the only state — replaces a tick counter and lets us derive
  // isFreeExpired in the body without reading Date.now() directly (which the
  // lint rule disallows as it's impure for render).
  const [now, setNow] = useState<number>(() => Date.now());
  const status      = session?.status;
  const joinedAt    = session?.joined_at;
  const freeMinutes = session?.free_minutes ?? 10;
  const freeExpiredAt    = session?.free_expired_at;
  const paidExtensionAt  = session?.paid_extension_at;
  const sessionId        = session?.id;

  // Tick only while the session is in a state whose expiry we care about.
  useEffect(() => {
    if (status !== "live" && status !== "expired_free") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Derived from `now` in state — pure with respect to render inputs.
  const isFreeExpired =
    status === "live" && !!joinedAt &&
    now - new Date(joinedAt).getTime() >= freeMinutes * 60 * 1000;

  useEffect(() => {
    if (!sessionId) return;
    const sb = createClient();

    if (status === "live" && isFreeExpired) {
      if (paidMinutesRemaining > 0) {
        if (!paidExtensionAt) {
          void sb.from("guest_calls").update({ paid_extension_at: new Date().toISOString() }).eq("id", sessionId);
        }
        return;
      }
      void sb.rpc("expire_to_free", { _session_id: sessionId });
      return;
    }

    if (status === "expired_free" && freeExpiredAt) {
      const elapsedMs = now - new Date(freeExpiredAt).getTime();
      if (elapsedMs >= 10 * 60_000) {
        void (async () => {
          await sb.rpc("end_session", { _session_id: sessionId, _reason: "payment_buffer_expired" });
          void sb.functions.invoke("summarize-guest-call", { body: { guest_call_id: sessionId } });
        })();
      }
    }
  }, [sessionId, status, isFreeExpired, paidExtensionAt, freeExpiredAt, paidMinutesRemaining, now]);
}

// ── Main ───────────────────────────────────────────────────────────────────
export function RoomClient() {
  const router = useRouter();
  const state  = useCustomerSession();

  // Free-cap + buffer watchdog. Self-contained — does its own 1s ticking
  // only when status is "live"/"expired_free", so the whole tree no longer
  // re-renders every second.
  useFreeSessionLifecycle(state.session, state.entitlement.paid_minutes_remaining);

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

  // Auto-join: as soon as the server stamps engineer_joined_at on the session,
  // flip accepted + mark_joined so the customer is dropped straight into the
  // call. Replaces the old click-to-answer IncomingCallModal step.
  // mark_joined is idempotent — if Zoom's onJoined fires later it's a no-op.
  useEffect(() => {
    if (accepted) return;
    if (!state.session) return;
    if (!shouldShowIncomingCall(state.session)) return;
    setAccepted(true);
    void state.markJoined();
  }, [
    state.session?.id,
    state.session?.engineer_joined_at,
    state.session?.zoom_meeting_id,
    state.session?.customer_joined_at,
    state.session?.status,
    accepted,
    state.markJoined,
  ]);

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

  // (Free-session lifecycle moved to useFreeSessionLifecycle — see hook above.)

  // ── Projects + new-session gate ────────────────────────────────────────────
  // Shown in the central pane when the user starts a brand-new session.
  // Lets the user pick from an existing project or name a new one.
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  // Reload the project list whenever auth changes or a session ends —
  // ending one may add a new project (since create happens at session start).
  const refetchProjects = useCallback(async () => {
    if (state.auth.kind !== "authed") return;
    const sb = createClient();
    const { data, error } = await sb
      .from("projects")
      .select("id, name, created_at")
      .eq("customer_id", state.auth.userId)
      .order("created_at", { ascending: false });
    if (error) return;
    setProjects((data ?? []).map((r) => ({
      id:        r.id as string,
      name:      r.name as string,
      createdAt: r.created_at as string,
    })));
  }, [state.auth]);
  useEffect(() => { void refetchProjects(); }, [refetchProjects, state.session?.id, state.session?.status]);

  // Track initial load so that subsequent startNewSession() calls
  // (which briefly set loading=true + session=null) don't flash a
  // full-screen spinner — the project form stays visible instead.
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  useEffect(() => {
    if (!state.loading && state.auth.kind !== "loading") {
      setInitialLoadDone(true);
    }
  }, [state.loading, state.auth.kind]);

  // First-time customer: auto-open the project name form once when the
  // room mounts with no active session AND zero past sessions. Idempotent —
  // we only ever check once per page load.
  const firstTimeCheckedRef = useRef(false);
  useEffect(() => {
    if (firstTimeCheckedRef.current) return;
    if (!initialLoadDone) return;
    if (state.auth.kind !== "authed") return;
    if (state.session) return;             // already has (or had) an active session
    firstTimeCheckedRef.current = true;
    void (async () => {
      const sb = createClient();
      const { count } = await sb
        .from("guest_calls")
        .select("id", { count: "exact", head: true })
        .eq("customer_user_id", state.auth.kind === "authed" ? state.auth.userId : "")
        .limit(1);
      if ((count ?? 0) === 0) {
        setProjectFormOpen(true);
      }
    })();
  }, [initialLoadDone, state.auth, state.session]);

  // Used by the picker pane: either pick an existing project (existingId)
  // or create a new one with a given name. Either way, start a session
  // bound to that project; if there's a pending composer draft, send it too.
  const startSessionInProject = useCallback(async (
    arg: { existingId: string } | { newName: string },
  ) => {
    const sb = createClient();
    let projectId: string | null = null;

    if ("existingId" in arg) {
      projectId = arg.existingId;
    } else {
      // Create the project first. Properly surface errors — previously
      // we only destructured { data } and silently swallowed any { error },
      // which caused every session to land under "General" even when the
      // user had named a project.
      const { data, error: createErr } = await sb.rpc("create_project", { _name: arg.newName });
      if (createErr) {
        console.warn("[startSessionInProject] create_project failed:", createErr.message);
        throw new Error(createErr.message);
      }
      if (data) {
        const row = Array.isArray(data)
          ? (data[0] as { id?: string })
          : (data as { id?: string });
        projectId = row?.id ?? null;
        if (!projectId) {
          console.warn("[startSessionInProject] create_project returned data but no id:", data);
        }
      }
    }

    // Before creating a new session, cancel any lingering active session in
    // the DB. Without this, get_or_create_active_customer_session returns the
    // old session (which has project_id = null) instead of creating a fresh
    // one in the right project.
    const userId = state.auth.kind === "authed" ? state.auth.userId : null;
    if (userId) {
      const { data: activeSessions } = await sb
        .from("guest_calls")
        .select("id, project_id")
        .eq("customer_user_id", userId)
        .in("status", ["queued", "assigned", "joining", "live", "grace", "ending", "expired_free"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (activeSessions && activeSessions.length > 0) {
        const existing = activeSessions[0] as { id: string; project_id: string | null };
        // Cancel the old session if it has a different project (or no project).
        // If it's already in the right project, just use it (the RPC will return it).
        if (existing.project_id !== projectId) {
          await sb.rpc("cancel_customer_session", { _session_id: existing.id });
        }
      }
    }

    if (pendingDraft) {
      await state.sendOrStart(pendingDraft, projectId ?? undefined);
      setPendingDraft(null);
    } else {
      await state.startNewSession(projectId ?? undefined);
    }
    setProjectFormOpen(false);
    void refetchProjects();
  }, [pendingDraft, state, refetchProjects]);

  // Existing call signature kept for the picker pane.
  const handleProjectConfirmNew  = useCallback((name: string) => startSessionInProject({ newName: name }),  [startSessionInProject]);
  const handleProjectConfirmPick = useCallback((id: string)   => startSessionInProject({ existingId: id }), [startSessionInProject]);

  // Called from sidebar's "+ inside project" affordance: skips the picker
  // entirely and starts a session directly in that project.
  const handleStartInProject = useCallback((projectId: string | null) => {
    // Entitlement check before we do anything else.
    const hasFreeLeft = !state.entitlement.free_consumed_at;
    const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
    if (!hasFreeLeft && !hasPaidLeft) {
      setPaywallOpen("no_credits");
      return;
    }
    setViewingPastId(null);
    setPendingDraft(null);
    if (projectId) {
      void startSessionInProject({ existingId: projectId });
    } else {
      // null = General bucket → open the picker so user can name a project.
      setProjectFormOpen(true);
    }
  }, [state.entitlement, startSessionInProject]);

  // ── Stable handlers for the Sidebar / MainPane subtrees ──────────────────
  // Wrapping every child-bound callback in useCallback so React.memo on
  // Sidebar / MainPane / ChatPane / UserMenu can short-circuit identity
  // checks. Deps are narrowed to the smallest values that actually matter.
  const freeConsumed = !!state.entitlement.free_consumed_at;
  const paidRemaining = state.entitlement.paid_minutes_remaining;
  const sidebarEmail = state.auth.kind === "authed" ? state.auth.email : "";
  const sidebarCustomerUserId = state.auth.kind === "authed" ? state.auth.userId : null;

  const handleViewPast = useCallback((id: string | null) => {
    setViewingPastId(id);
    if (id) setProjectFormOpen(false);
  }, []);

  const handleNewSession = useCallback(() => {
    if (freeConsumed && paidRemaining <= 0) {
      setPaywallOpen("no_credits");
      return;
    }
    setViewingPastId(null);
    setPendingDraft(null);
    setProjectFormOpen(true);
  }, [freeConsumed, paidRemaining]);

  const handleWalletClick = useCallback(() => {
    if (freeConsumed && paidRemaining <= 0) setPaywallOpen("no_credits");
  }, [freeConsumed, paidRemaining]);

  const handleCloseViewPast = useCallback(() => setViewingPastId(null), []);
  const handleNeedsCredits  = useCallback(() => setPaywallOpen("no_credits"), []);
  const handleProjectCancel = useCallback(() => setProjectFormOpen(false), []);
  const handleNeedProject   = useCallback((draft: string) => {
    setPendingDraft(draft);
    setProjectFormOpen(true);
  }, []);

  // Only show the full-screen loader on the very first load.
  // After initialLoadDone = true, session creation happens while the project
  // form (or existing UI) stays on screen — no jarring full-page flash.
  if (!initialLoadDone) return <FullScreenLoader />;
  if (state.auth.kind === "anonymous") return null;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
    >
      <Sidebar
        email={sidebarEmail}
        customerUserId={sidebarCustomerUserId}
        session={state.session}
        entitlement={state.entitlement}
        viewingPastId={viewingPastId}
        projects={projects}
        onViewPast={handleViewPast}
        onNewSession={handleNewSession}
        onStartInProject={handleStartInProject}
        onWalletClick={handleWalletClick}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating status / timer chip + end-meeting button (top-right) */}
        <FloatingStatus
          session={state.session}
          accepted={accepted}
          onEnd={state.end}
        />

        <main className="min-h-0 flex-1">
          <MainPane
            state={state}
            accepted={accepted}
            viewingPastId={viewingPastId}
            onCloseViewPast={handleCloseViewPast}
            onNeedsCredits={handleNeedsCredits}
            projectFormOpen={projectFormOpen}
            pendingDraft={pendingDraft}
            projects={projects}
            onProjectConfirmNew={handleProjectConfirmNew}
            onProjectConfirmPick={handleProjectConfirmPick}
            onProjectCancel={handleProjectCancel}
            onNeedProject={handleNeedProject}
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
// We show a "{engineer} is connecting with you" card so the customer isn't
// left with the queue's avg-wait timer ticking after the request was already
// picked up. Dismissed automatically once engineer_joined_at is stamped —
// at that point the auto-join effect flips `accepted` and the split layout
// (chat + Zoom embed) replaces this modal.
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
    // Use localStorage (not sessionStorage) so the "already shown" flag
    // survives page reloads and new tabs — the modal never re-appears for
    // the same session ID once the customer has seen it.
    const key = `relay-connecting-shown:${sessionId}`;
    try {
      if (localStorage.getItem(key)) {
        setShow(false);
        return;
      }
      localStorage.setItem(key, "1");
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
const MainPane = memo(function MainPane({
  state, accepted, viewingPastId, onCloseViewPast, onNeedsCredits,
  projectFormOpen, pendingDraft, projects,
  onProjectConfirmNew, onProjectConfirmPick, onProjectCancel, onNeedProject,
}: {
  state: ReturnType<typeof useCustomerSession>;
  accepted: boolean;
  viewingPastId: string | null;
  onCloseViewPast: () => void;
  onNeedsCredits: () => void;
  projectFormOpen: boolean;
  pendingDraft: string | null;
  projects: Project[];
  onProjectConfirmNew:  (name: string) => Promise<void>;
  onProjectConfirmPick: (id: string)   => Promise<void>;
  onProjectCancel: () => void;
  onNeedProject: (draft: string) => void;
}) {
  const session = state.session;

  // ── Project picker pane: pick an existing project or name a new one ──────
  // Skip if the user is reviewing a past session — let the review pane take over.
  if (projectFormOpen && !viewingPastId) {
    return (
      <ProjectPickerPane
        pendingText={pendingDraft}
        projects={projects}
        onConfirmNew={onProjectConfirmNew}
        onConfirmPick={onProjectConfirmPick}
        onCancel={onProjectCancel}
      />
    );
  }

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

  // Everything else renders the welcome / chat landing. The composer
  // intercepts new-session creation to show the project name form first.
  return <ChatPane state={state} fullWidth onNeedsCredits={onNeedsCredits} onNeedProject={onNeedProject} />;
});

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

// ── Project picker pane ────────────────────────────────────────────────────
// Shown in the central area (not a modal overlay) when the user is about to
// start a new session. Two options on one screen:
//   1. Pick one of their existing projects (scrollable list).
//   2. Or create a new project by typing its name.
// First-time users see only the input; returning users get both.
function ProjectPickerPane({
  pendingText, projects, onConfirmNew, onConfirmPick, onCancel,
}: {
  pendingText: string | null;
  projects: Project[];
  onConfirmNew:  (name: string) => Promise<void>;
  onConfirmPick: (id: string)   => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirmNew(name.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — try again.");
      setBusy(false);
    }
  };

  const handlePick = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirmPick(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — try again.");
      setBusy(false);
    }
  };

  const hasProjects = projects.length > 0;

  return (
    <section
      className="relative flex h-full flex-col items-center px-4 py-10"
      style={{ backgroundColor: "var(--surface)" }}
    >
      {/* Cancel */}
      <button
        onClick={onCancel}
        className="absolute right-4 top-4 rounded-md p-1 opacity-40 transition-opacity hover:opacity-80"
        style={{ color: "var(--text-muted)" }}
        aria-label="Cancel"
        title="Cancel"
      >
        <X size={16} />
      </button>

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
          <h2
            className="text-3xl font-semibold tracking-tight sm:text-[36px]"
            style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
          >
            {hasProjects ? "Start a new session" : "Name your project"}
          </h2>
        </div>
        <p className="mb-6 text-base" style={{ color: "var(--text-muted)" }}>
          {hasProjects
            ? "Pick one of your projects, or create a new one for this session."
            : "Sessions live inside projects. Give this one a short name so you can find it later."}
        </p>

        {/* Existing projects */}
        {hasProjects && (
          <>
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Your projects
            </div>
            <div
              className="mb-6 max-h-64 overflow-y-auto rounded-xl border"
              style={{ borderColor: "var(--border)" }}
            >
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void handlePick(p.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                >
                  <Folder size={14} style={{ color: BRAND_GREEN, flexShrink: 0 }} />
                  <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
                    {p.name}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    →
                  </span>
                </button>
              ))}
            </div>

            {/* Divider */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                or create new
              </span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
            </div>
          </>
        )}

        {/* New project input */}
        <div
          className="relative rounded-2xl border shadow-sm transition-all focus-within:ring-2"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
            ["--tw-ring-color" as string]: BRAND_GREEN_BORDER,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleCreate(); }
            }}
            disabled={busy}
            placeholder="e.g. Payment API, Login bug, Deploy issue…"
            className="h-12 w-full rounded-2xl bg-transparent pl-4 pr-12 text-sm outline-none disabled:cursor-not-allowed"
            style={{ color: "var(--text)" }}
          />
          <button
            onClick={() => void handleCreate()}
            disabled={!name.trim() || busy}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>

        {err && (
          <p className="mt-2 text-[12px]" style={{ color: "var(--accent-red, #e05c4b)" }}>
            {err}
          </p>
        )}

        <p className="mt-3 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
          Press Enter to create
        </p>

        {/* Carry-forward draft from composer */}
        {pendingText && (
          <p className="mt-5 rounded-xl border px-3 py-2 text-[11px] italic"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            Your message: &ldquo;{pendingText}&rdquo;
          </p>
        )}
      </div>
    </section>
  );
}

function fmtName(auth: ReturnType<typeof useCustomerSession>["auth"]) {
  if (auth.kind === "authed") return auth.email.split("@")[0] || "Customer";
  return "Customer";
}
function emailOf(auth: ReturnType<typeof useCustomerSession>["auth"]) {
  return auth.kind === "authed" ? auth.email : null;
}

// ── Floating status chip (top-right) ───────────────────────────────────────
// Owns its own session timer so the 1-second tick stays local to this
// subtree instead of cascading from RoomClient down to Sidebar/MainPane/etc.
const FloatingStatus = memo(function FloatingStatus({
  session, accepted, onEnd,
}: {
  session: GuestCall | null;
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
            <LiveTimerPill joinedAt={session!.joined_at ?? null} freeMinutes={session!.free_minutes ?? 10} />
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
});

// Wraps TimerPill so the useSessionTimer 1-second tick is scoped to this
// tiny subtree — only the pill re-renders each second, never its parent.
function LiveTimerPill({ joinedAt, freeMinutes }: { joinedAt: string | null; freeMinutes: number }) {
  const timer = useSessionTimer(joinedAt, freeMinutes);
  return <TimerPill warning={timer.isWarning} expired={timer.isExpired} formatRemaining={timer.formatRemaining} />;
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
type PastSession = {
  id: string;
  title: string;
  agent: string | null;
  minutes: number | null;
  date: string;
  status: SessionStatus;
  projectId: string | null;
  projectName: string | null;
};

// One row from the `projects` table — the source of truth for what
// projects exist (even ones with no sessions yet).
type Project = {
  id: string;
  name: string;
  createdAt: string;
};

type ProjectGroup = {
  key: string;           // projectId or "general"
  name: string;          // display name
  sessions: PastSession[];
  latestDate: number;    // ms timestamp — used for sorting
};

const Sidebar = memo(function Sidebar({
  email, customerUserId, session, entitlement, viewingPastId, projects,
  onViewPast, onNewSession, onStartInProject, onWalletClick,
}: {
  email: string;
  customerUserId: string | null;
  session: GuestCall | null;
  entitlement: { free_consumed_at: string | null; free_minutes_used: number; paid_minutes_remaining: number };
  viewingPastId: string | null;
  projects: Project[];
  onViewPast: (id: string | null) => void;
  /** Top-level "+ New session" — opens picker that lets the user pick a
   *  project (existing or new) before the session is created. */
  onNewSession: () => void;
  /** Inline "+" inside a project row — starts a session bound to that
   *  exact project, skipping the picker. */
  onStartInProject: (projectId: string | null) => void;
  onWalletClick: () => void;
}) {
  // Sidebar starts collapsed; state is persisted in localStorage so the
  // user's preference survives page reloads.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("relay-sidebar-collapsed") !== "false"; }
    catch { return true; }
  });
  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next);
    try { localStorage.setItem("relay-sidebar-collapsed", next ? "true" : "false"); } catch {}
  };

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [past, setPast] = useState<PastSession[]>([]);
  // Global search — filters both project names and session titles/agents.
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!customerUserId) return;
    const sb = createClient();
    void (async () => {
      // Pull *every* session the customer has had — active, terminal, the
      // works. We want each one to appear inside its project folder so the
      // sidebar reflects the live state, not just past history. The
      // currently-active session is marked with a pulse below.
      const FULL =
        "id, guest_name, agent_name, duration_minutes, ai_summary_title, created_at, status, project_id, project_name";
      const SLIM =
        "id, guest_name, agent_name, duration_minutes, ai_summary_title, created_at, status";

      let rows: Record<string, unknown>[] | null = null;
      let { data, error } = await sb
        .from("guest_calls")
        .select(FULL)
        .eq("customer_user_id", customerUserId)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) {
        const retry = await sb
          .from("guest_calls")
          .select(SLIM)
          .eq("customer_user_id", customerUserId)
          .order("created_at", { ascending: false })
          .limit(80);
        if (retry.error) {
          console.warn("[sidebar] sessions query failed:", retry.error.message);
          return;
        }
        rows = (retry.data ?? []) as Record<string, unknown>[];
      } else {
        rows = (data ?? []) as Record<string, unknown>[];
      }

      setPast(rows.map((row) => {
        const status = row.status as SessionStatus;
        // Synthesise a label for sessions that don't have an AI summary yet
        // (active ones, or summary generation pending). The status hint
        // helps the customer find a specific session.
        const fallbackLabel = status === "ended"     ? "Past session"
                            : status === "cancelled" ? "Cancelled session"
                            : status === "abandoned" ? "No engineer found"
                            : "Active session";
        return {
          id:          row.id as string,
          title:       (row.ai_summary_title as string | null) ?? fallbackLabel,
          agent:       row.agent_name as string | null,
          minutes:     row.duration_minutes != null ? Math.round(Number(row.duration_minutes)) : null,
          date:        row.created_at as string,
          status,
          projectId:   (row.project_id   as string | null) ?? null,
          projectName: (row.project_name as string | null) ?? null,
        };
      }));
    })();
  }, [customerUserId, session?.id, session?.status]);

  // Build the project list shown in the sidebar from BOTH the `projects`
  // table (authoritative) and any session that has a project_id but is
  // missing from the table (defensive — e.g., orphan rows from a prior
  // migration state). Sessions with no project_id all bucket into "General".
  const projectGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matchSession = (s: PastSession) => {
      if (!q) return true;
      const hay = [s.title, s.agent ?? "", s.projectName ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    };
    const matchProjectName = (name: string) => !q || name.toLowerCase().includes(q);

    // Build a map keyed by project id.
    const map = new Map<string, ProjectGroup>();
    for (const p of projects) {
      map.set(p.id, {
        key: p.id,
        name: p.name,
        sessions: [],
        latestDate: new Date(p.createdAt).getTime(),
      });
    }
    // "General" bucket for sessions with no project.
    const general: ProjectGroup = { key: "general", name: "General", sessions: [], latestDate: 0 };

    for (const s of past) {
      const g = s.projectId && map.has(s.projectId) ? map.get(s.projectId)!
              : s.projectId ? (() => {
                  // Orphan: project_id set but project not in the table.
                  // Display the denormalised name from the session row.
                  const orphan: ProjectGroup = {
                    key: s.projectId!,
                    name: s.projectName ?? "Unnamed project",
                    sessions: [],
                    latestDate: 0,
                  };
                  map.set(s.projectId!, orphan);
                  return orphan;
                })()
              : general;
      g.sessions.push(s);
      const t = new Date(s.date).getTime();
      if (t > g.latestDate) g.latestDate = t;
    }
    if (general.sessions.length > 0) map.set("general", general);

    // Apply search filter: include a group if its name matches OR any of
    // its sessions match. Hide groups that have no surviving content.
    const groups = Array.from(map.values()).map((g) => {
      const nameHit = matchProjectName(g.name);
      const sessions = g.sessions.filter(matchSession);
      // Empty project with name match → keep it visible (lets you start a
      // session in it even when there's no history yet).
      if (!q) return g;
      if (nameHit && sessions.length === 0 && g.sessions.length === 0) return { ...g, sessions };
      if (sessions.length > 0) return { ...g, sessions };
      if (nameHit) return g; // name hit, show all its sessions
      return null;
    }).filter((g): g is ProjectGroup => g !== null);

    return groups.sort((a, b) => b.latestDate - a.latestDate);
  }, [projects, past, searchQuery]);

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
          onClick={() => toggleCollapsed(false)}
          title="Expand sidebar"
          className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelLeftOpen size={18} />
        </button>

        {/* New session */}
        <button
          onClick={onNewSession}
          title="New session"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: BRAND_GREEN }}
        >
          <Plus size={18} />
        </button>

        {/* Search — expanding the rail makes the input focusable */}
        <button
          onClick={() => toggleCollapsed(false)}
          title="Search sessions"
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
              session={session}
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
          onClick={() => toggleCollapsed(true)}
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
          onClick={onNewSession}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text)" }}
        >
          <Plus size={16} style={{ color: BRAND_GREEN }} />
          New session
        </button>
        {/* Search across all past sessions (title / engineer / project). */}
        <div
          className="mt-0.5 flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
        >
          <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:opacity-60"
            style={{ color: "var(--text)" }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Current session callout (only when active) */}
      {hasActiveSession && (
        <div className="px-2 pt-2">
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
        </div>
      )}

      {/* Projects (each is a folder containing sessions) */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-3">
        <div className="mb-1 flex items-center justify-between px-2.5 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
            Projects
          </span>
          <button
            onClick={onNewSession}
            title="New project + session"
            aria-label="New project"
            className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <Plus size={12} />
          </button>
        </div>

        {projectGroups.length > 0
          ? projectGroups.map((group) => (
              <ProjectAccordion
                key={group.key}
                group={group}
                viewingPastId={viewingPastId}
                currentSessionId={session?.id ?? null}
                onViewPast={onViewPast}
                onStartInProject={onStartInProject}
              />
            ))
          : (
            <p className="px-2 py-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {searchQuery
                ? `No projects or sessions match "${searchQuery}".`
                : "Start your first project to get going."}
            </p>
          )
        }
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
              <WalletBalance session={session} entitlement={entitlement} />
            </div>
          </div>
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
        </button>
        {userMenuOpen && (
          <UserMenu
            email={email}
            session={session}
            entitlement={entitlement}
            onRecharge={() => { setUserMenuOpen(false); onWalletClick(); }}
            onClose={() => setUserMenuOpen(false)}
          />
        )}
      </div>
    </aside>
  );
});

type EntitlementShape = { free_consumed_at: string | null; free_minutes_used: number; paid_minutes_remaining: number };

function formatEntitlement(e: EntitlementShape): string {
  if (e.paid_minutes_remaining > 0) {
    // Always show 2-decimal precision: 100.00, 97.50, 93.25 …
    return `${e.paid_minutes_remaining.toFixed(2)} min paid`;
  }
  if (e.free_consumed_at) return "Free used · upgrade to continue";
  return "10 min free available";
}

// Wallet text that ticks down DURING a live paid session, without forcing
// the whole sidebar tree to re-render. Owns its own 1s interval, scoped to
// this leaf component only — render scope is one <span>.
const WalletBalance = memo(function WalletBalance({
  session, entitlement,
}: {
  session: GuestCall | null;
  entitlement: EntitlementShape;
}) {
  const isLive   = session?.status === "live";
  const joinedAt = session?.joined_at ?? null;
  const paidAt   = session?.paid_extension_at ?? null;
  const freeConsumed = !!entitlement.free_consumed_at;
  // Only tick when we'd actually be subtracting paid time from the balance.
  const shouldTick = isLive && (!!paidAt || freeConsumed);

  // Store the clock in state so the body stays pure for the lint rule.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!shouldTick) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [shouldTick]);

  let live = entitlement;
  if (shouldTick) {
    let paidElapsedMin = 0;
    if (paidAt) {
      paidElapsedMin = Math.max(0, (now - new Date(paidAt).getTime()) / 60_000);
    } else if (joinedAt) {
      paidElapsedMin = Math.max(0, (now - new Date(joinedAt).getTime()) / 60_000);
    }
    if (paidElapsedMin > 0) {
      live = {
        ...entitlement,
        paid_minutes_remaining: Math.max(0, entitlement.paid_minutes_remaining - paidElapsedMin),
      };
    }
  }
  return <>{formatEntitlement(live)}</>;
});

function planLabel(e: { free_consumed_at: string | null; paid_minutes_remaining: number }): string {
  if (e.paid_minutes_remaining > 0) return "Paid plan";
  return "Free plan";
}

// ── User menu dropdown (Claude-style) ─────────────────────────────────────
const UserMenu = memo(function UserMenu({
  email, session, entitlement, onRecharge, onClose, collapsed = false,
}: {
  email: string;
  session: GuestCall | null;
  entitlement: EntitlementShape;
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
                  <WalletBalance session={session} entitlement={entitlement} />
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
});

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

// Human-readable relative date label for session rows inside the accordion.
function fmtRelDate(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  if (day >= today)     return "Today";
  if (day >= yesterday) return "Yesterday";
  const diff = Math.floor((today.getTime() - day.getTime()) / 86_400_000);
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Project accordion (collapsible group in the sidebar) ───────────────────
const ProjectAccordion = memo(function ProjectAccordion({
  group, viewingPastId, currentSessionId, onViewPast, onStartInProject,
}: {
  group: ProjectGroup;
  viewingPastId: string | null;
  /** Id of the currently-live session, if any. Clicking that row jumps
   *  back to the live view (onViewPast(null)) rather than opening it as
   *  a past-session review. */
  currentSessionId: string | null;
  onViewPast: (id: string | null) => void;
  /** Called when the user clicks "+ Start session in this project". null
   *  is passed for the General bucket (no project id). */
  onStartInProject: (projectId: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  // The General bucket doesn't have a real project id and can't be
  // "started in" — sessions go there only as a fallback.
  const isGeneral = group.key === "general";

  return (
    <div className="mb-1 group/proj">
      {/* Project header */}
      <div className="relative flex items-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <ChevronRight
            size={11}
            style={{
              color: "var(--text-muted)",
              flexShrink: 0,
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
          <Folder size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span
            className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-muted)" }}
          >
            {group.name}
          </span>
          <span
            className="ml-1 shrink-0 rounded-full px-1.5 py-0 text-[9px] tabular-nums"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 7%, transparent)",
              color: "var(--text-muted)",
            }}
          >
            {group.sessions.length}
          </span>
        </button>
        {!isGeneral && (
          <button
            onClick={(e) => { e.stopPropagation(); onStartInProject(group.key); }}
            title={`New session in ${group.name}`}
            aria-label={`New session in ${group.name}`}
            className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-black/5 dark:hover:bg-white/5 group-hover/proj:opacity-100 focus:opacity-100"
            style={{ color: BRAND_GREEN }}
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      {/* Session rows */}
      {open && (
        <div className="ml-2 mt-0.5 space-y-0.5">
          {group.sessions.length === 0 && !isGeneral ? (
            <button
              onClick={() => onStartInProject(group.key)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] italic transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={11} style={{ color: BRAND_GREEN }} />
              Start your first session here
            </button>
          ) : [...group.sessions]
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .map((s) => {
            const selected = viewingPastId === s.id;
            const isActive = !["ended", "abandoned", "cancelled"].includes(s.status);
            const isCurrent = isActive && s.id === currentSessionId;
            return (
              <button
                key={s.id}
                onClick={() => onViewPast(isCurrent ? null : s.id)}
                className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={selected ? { backgroundColor: BRAND_GREEN_SOFT } : undefined}
              >
                {isActive && (
                  <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
                    <span className="absolute inset-0 rounded-full opacity-70"
                      style={{ backgroundColor: BRAND_GREEN, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }} />
                    <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[13px]"
                    style={{ color: selected ? BRAND_GREEN : isActive ? BRAND_GREEN : "var(--text)" }}
                  >
                    {s.title}
                  </div>
                  <div
                    className="mt-0.5 flex items-center gap-1 text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {isActive
                      ? <span>{humanState(s.status)}</span>
                      : <>
                          {s.agent && <span>{s.agent}</span>}
                          {s.agent && <span>·</span>}
                          <span>{fmtRelDate(new Date(s.date))}</span>
                          {s.minutes != null && s.minutes > 0 && (
                            <><span>·</span><span>{s.minutes}m</span></>
                          )}
                        </>
                    }
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ── Chat pane ──────────────────────────────────────────────────────────────
const ChatPane = memo(function ChatPane({
  state, fullWidth = false, onNeedsCredits, onNeedProject,
}: {
  state: ReturnType<typeof useCustomerSession>;
  fullWidth?: boolean;
  onNeedsCredits?: () => void;
  /** Called when the user types and a new session would be created.
   *  Instead of creating immediately, open the project-name gate. */
  onNeedProject?: (draft: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const session = state.session;
  // Only `ended` is truly read-only (post-call view). cancelled / abandoned
  // are equivalent to "no session" — the composer shows the project form first.
  const isReadOnly = session?.status === "ended";

  const onSend = async () => {
    if (!draft.trim()) return;
    const wouldCreateNew = !session || ["cancelled", "abandoned", "ended"].includes(session.status);
    const hasFreeLeft = !state.entitlement.free_consumed_at;
    const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
    // No entitlement → paywall
    if (wouldCreateNew && !hasFreeLeft && !hasPaidLeft && onNeedsCredits) {
      onNeedsCredits();
      return;
    }
    // Would create a new session → show project name form first
    if (wouldCreateNew && onNeedProject) {
      onNeedProject(draft.trim());
      setDraft("");
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
});

const Message = memo(function Message({ message }: { message: GuestMessage }) {
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
});

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
          {engineerName} is connecting with you
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          You&apos;ll be joined to the call automatically — hold tight.
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
