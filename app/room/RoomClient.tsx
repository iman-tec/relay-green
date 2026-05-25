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
 *   live (engineer in Zoom) → ChatPane full width. Each Zoom meeting
 *                              renders as its own inline ZoomCallCard in
 *                              the message timeline (WhatsApp-style call
 *                              entries). Zoom opens in a new tab; we no
 *                              longer embed the SDK.
 *
 *   ended                   → PostCallView (locked chat + AI summary)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PanelGroup, Panel, PanelResizeHandle,
} from "react-resizable-panels";
import {
  Plus, Send, Sparkles, Phone, X, PhoneOff, MessageSquare, Lock,
  AlertTriangle, Loader2, ChevronDown, ChevronRight, Search, PanelLeftClose, PanelLeftOpen,
  Wallet, RefreshCw, Settings, LogOut, Check, Folder, Pencil, PanelRightOpen, PanelRightClose,
  Building2, FileText, Clock, Video, MoreHorizontal, UserPlus,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { MeetingChatEntry } from "@/app/_components/MeetingChatEntry";
import { MeetingSummaryEntry, isAiSummaryMessageBody } from "@/app/_components/MeetingSummaryEntry";
import { PaywallModal } from "@/app/_components/PaywallModal";
import { ChatComposer } from "@/app/_components/ChatComposer";
import { MessageAttachments } from "@/app/_components/MessageAttachments";
import { Button, EmptyState, IconButton, Modal, cn } from "@/app/_components/ui";
import { useCustomerSession } from "@/lib/relay/useCustomerSession";
import { useIsSupervisor, isSupervisorOnlyMessage } from "@/lib/relay/useIsSupervisor";
import { useSessionTimer } from "@/lib/relay/useSessionTimer";
import { computeSessionClock } from "@/lib/relay/sessionClock";
import { createClient } from "@/lib/supabase/browser";
import { patchProfile, readProfile } from "@/lib/relay/profile";
import { IntakeAssistant } from "@/app/_components/intake/IntakeAssistant";
import { GlobalNewChatModal } from "@/app/_components/GlobalNewChatModal";
import type { GuestCall, GuestMessage, SessionStatus, Urgency } from "@/lib/supabase/types";

// Re-pointed to design-system CSS vars after the white-theme transformation.
// Kept as named constants so existing call-sites (style={{ color: BRAND_GREEN }})
// continue to work; the values themselves now resolve through globals.css.
const BRAND_GREEN       = "var(--primary)";
const BRAND_GREEN_SOFT  = "var(--primary-soft)";
const BRAND_GREEN_BORDER = "color-mix(in srgb, var(--primary) 32%, transparent)";
const URGENT_AMBER      = "var(--warn)";
const URGENT_AMBER_SOFT = "var(--warn-soft)";
const CRIT_RED          = "var(--risk)";
const CRIT_RED_SOFT     = "var(--risk-soft)";

// ── Free-session lifecycle hook ───────────────────────────────────────────
// Owns the 1-second tick needed to detect free-cap expiry + buffer-expiry,
// and fires the corresponding RPCs. Kept OUT of RoomClient's body so the
// per-second re-render scope is local to this hook — none of the sidebar /
// chat / zoom tree re-renders just because the timer ticked.
// Active states where the timer is ticking and the free 10-min cap is
// counting. Includes pre-Zoom states because chat starts the moment the
// engineer claims — chat + Zoom time both count toward the 10-min free cap.
const ACTIVE_TIMER_STATES = ["assigned", "joining", "live", "grace", "expired_free"] as const;

function useFreeSessionLifecycle(
  session: GuestCall | null,
  entitlement: { free_consumed_at: string | null; paid_minutes_remaining: number },
) {
  // `now` is the only state — replaces a tick counter and lets us derive the
  // clock in the body without reading Date.now() directly (which the lint
  // rule disallows as it's impure for render).
  const [now, setNow] = useState<number>(() => Date.now());
  const status      = session?.status;
  // Anchor the clock on assigned_at — billing starts when the engineer accepts
  // and the session/chat begins (matches the server's end_session anchor). NOT
  // tied to Zoom: starting a Zoom call mid-session never resets the clock.
  const anchor      = session?.assigned_at ?? session?.joined_at ?? null;
  const freeMinutes = session?.free_minutes ?? 10;
  const paidExtensionAt    = session?.paid_extension_at ?? null;
  const sessionId          = session?.id;
  const freeConsumed       = entitlement.free_consumed_at != null;
  const paidMinutesRemaining = entitlement.paid_minutes_remaining;

  const isActive = !!status && (ACTIVE_TIMER_STATES as readonly string[]).includes(status);

  // Tick only while the session is in a state whose expiry we care about.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // Single source of truth for free + paid enforcement (see sessionClock).
  // Three outcomes it can ask for:
  //   • shouldPivotToPaid  free cap hit, balance available → start paid time
  //   • shouldEnd          free expired with no balance, OR paid balance
  //                        exhausted → hard end with the matching reason
  const clock = isActive
    ? computeSessionClock({ anchor, now, freeMinutes, freeConsumed, paidExtensionAt, paidMinutesRemaining })
    : null;
  const shouldPivot = !!clock?.shouldPivotToPaid;
  const shouldEnd   = !!clock?.shouldEnd;
  const endReason   = clock?.endReason ?? null;

  useEffect(() => {
    if (!sessionId) return;
    const sb = createClient();

    // Customer has paid balance and just crossed the free cap → silently
    // pivot onto paid time. The timer mode flips from countdown to count-up
    // on the next render; billing then meters from paid_extension_at.
    if (shouldPivot) {
      if (!paidExtensionAt) {
        void sb.from("guest_calls").update({ paid_extension_at: new Date().toISOString() }).eq("id", sessionId);
      }
      return;
    }

    // Hard end — free expired with zero balance, OR the paid balance ran out
    // mid-call (the bug: nothing used to stop a paid session). end_session is
    // idempotent on terminal states, so duplicate firings (customer + engineer
    // tabs both ticking) collapse safely. summarize-guest-call +
    // end-zoom-meeting are fire-and-forget.
    if (shouldEnd) {
      void (async () => {
        await sb.rpc("end_session", { _session_id: sessionId, _reason: endReason ?? "free_session_expired" });
        void sb.functions.invoke("summarize-guest-call", { body: { guest_call_id: sessionId } });
        void sb.functions.invoke("end-zoom-meeting", { body: { session_id: sessionId } });
      })();
    }
  }, [sessionId, shouldPivot, shouldEnd, endReason, paidExtensionAt]);
}

// ── Main ───────────────────────────────────────────────────────────────────
// Hoisted so the top-level RoomClient employment fetch can reference it.
// The EmployeeInfoBlock component further down also uses this shape.
type EmployeeInfo =
  | { isEmployee: false }
  | {
      isEmployee:       true;
      enterpriseName:   string;
      departmentName:   string | null;
      allocatedMinutes: number;
      usedMinutes:      number;
      remainingMinutes: number;
    };

export function RoomClient() {
  const router = useRouter();
  const state  = useCustomerSession();

  // Employment probe — used to switch the plan chip into "Enterprise plan"
  // / "Out of credits" and to suppress the buy-a-plan paywall for employees
  // (their minutes come from the dept pool, not a self-served Stripe plan).
  // Fetched once at mount; the result drives multiple downstream effects so
  // it lives here at the top rather than inside the user menu.
  const [employment, setEmployment] = useState<EmployeeInfo | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/customer/me-employment", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as EmployeeInfo;
        if (alive) setEmployment(body);
      } catch {
        /* silent — fall back to non-employee behaviour */
      }
    })();
    return () => { alive = false; };
  }, []);
  const isEmployee = employment?.isEmployee === true;

  // Free-cap + buffer watchdog. Self-contained — does its own 1s ticking
  // only when status is "live"/"expired_free", so the whole tree no longer
  // re-renders every second.
  useFreeSessionLifecycle(state.session, state.entitlement);

  // Desktop-shell integration: hide the floating orb widget while the
  // customer is in a session. Bridge is no-op in the plain browser.
  // Used to live in PopOutContainer (mounted with the now-removed Zoom
  // embed), so we drive the signal from the session status directly.
  useEffect(() => {
    const bridge = (
      window as unknown as { relay?: { setSessionActive?: (active: boolean) => void } }
    ).relay;
    if (!bridge?.setSessionActive) return;
    const status = state.session?.status;
    const active = !!status && !["ended", "cancelled", "abandoned"].includes(status);
    bridge.setSessionActive(active);
    return () => { bridge.setSessionActive?.(false); };
  }, [state.session?.status]);

  // Local: customer has acknowledged the incoming call. Kept around because
  // the auto-join effect below uses it as the latch that calls mark_joined()
  // exactly once when the engineer's Zoom appears.
  const [accepted, setAccepted] = useState(false);

  // The customer can click a past-session row in the sidebar to review it.
  // When set, we render the split layout with chat + summary for that row.
  const [viewingPastId, setViewingPastId] = useState<string | null>(null);

  // Project selection — drives the branded landing's CTA. When set, the
  // landing reads "Start a session in {project name}" and clicking it
  // mints directly in that project. Cleared once a session is created
  // (the new session inherits the project, so the context is satisfied).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Legacy ?matching=<intake_id> URL hop: older intake builds (and saved
  // tabs) push to /room?matching=X. Forward to the full-page matching
  // screen so the chat-while-ringing UI mounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const id = q.get("matching");
    if (id) router.replace(`/intake/matching/${id}`);
  }, [router]);

  // Async chat mode — "New chat" lands here with ?newchat=1. Suppress
  // the ConnectingModal even if a session goes queued in the background;
  // render the inline AsyncChatPane instead. Uses useSearchParams so the
  // effect fires when the user clicks "New chat" while already on /room
  // (router.push to same route would not re-mount otherwise).
  const searchParams = useSearchParams();
  const newChatParam = searchParams.get("newchat");
  const [asyncChatMode, setAsyncChatMode] = useState(false);
  useEffect(() => {
    if (newChatParam === "1") {
      setAsyncChatMode(true);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("newchat");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [newChatParam]);

  // (Continue / Start-follow-up resume is now handled inline in the
  // ReadOnlyChatPane button onClick — see `resumeInProject`. The prior
  // URL-roundtrip via ?continueSessionId was removed because the effect
  // could silently fail and leave the user stuck on /room?continueSessionId.)

  // Old localStorage flags from the removed useConnectingModalGate are
  // wiped on mount so existing customers don't carry forward suppression
  // for sessions they're still queued in. One-shot cleanup; can be deleted
  // after a release or two once everyone's flags are flushed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("relay-connecting-shown:")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore — quota / privacy mode */ }
  }, []);

  // Paywall opens when:
  //   - session is in expired_free state (live cap hit, buffer ticking)
  //   - session ended for free_session_expired with no paid credit
  //   - composer attempts a new session but no entitlement (manual trigger)
  // Employees never see the buy-a-plan paywall — their minutes come from
  // the dept pool, not a self-served Stripe plan. When they run out the
  // plan chip flips to "Out of credits"; topping up is their dept admin's
  // job, not theirs.
  const [paywallOpen, setPaywallOpen] = useState<null | "free_expired" | "no_credits" | "manual">(null);
  const [paidToast, setPaidToast] = useState<string | null>(null);

  // Explicit ?paywall= entry — e.g. the guest Try-RELAY funnel sends a
  // visitor here when their free 10 minutes are already used
  // (?paywall=free_used). Open the paywall on load with the matching reason
  // and clean the param so a refresh doesn't re-trigger it.
  const paywallParam = searchParams.get("paywall");
  useEffect(() => {
    if (!paywallParam) return;
    setPaywallOpen(paywallParam === "no_credits" ? "no_credits" : "free_expired");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("paywall");
      window.history.replaceState({}, "", url.toString());
    }
  }, [paywallParam]);
  // Shown when the customer tries to start/ring a new call while one is
  // already live — see onActiveCall guard in the start handlers below.
  const [callBlockMsg, setCallBlockMsg] = useState<string | null>(null);
  const blockNewCall = useCallback((): boolean => {
    const s = state.session?.status;
    // An engineer is already attached/attaching (or in wind-down / paywall
    // hold). Re-ringing here just spawns a second call — block it.
    const onCall = !!s && ["assigned", "joining", "live", "grace", "ending", "expired_free"].includes(s);
    if (onCall) {
      setCallBlockMsg("You're already on a call with an engineer — end it before starting a new one.");
      setTimeout(() => setCallBlockMsg(null), 4000);
    }
    return onCall;
  }, [state.session?.status]);
  useEffect(() => {
    if (isEmployee) return;
    if (state.session?.status === "expired_free") {
      setPaywallOpen("free_expired");
      return;
    }
    if (
      state.session?.status === "ended" &&
      (state.session.ended_reason === "free_session_expired" ||
        state.session.ended_reason === "paid_balance_exhausted") &&
      state.entitlement.paid_minutes_remaining <= 0
    ) {
      // Free trial OR paid credits ran the session to its end — surface the
      // recharge/upgrade path. "free_expired" copy covers both (upgrade to
      // continue); the paid case lands here once the wallet hits 0.
      setPaywallOpen("free_expired");
    }
  }, [state.session?.status, state.session?.ended_reason, state.entitlement.paid_minutes_remaining, isEmployee]);

  // If the RPC returned NO_ENTITLEMENT, pop paywall — but skip for employees.
  useEffect(() => {
    if (isEmployee) return;
    if (state.error === "NO_ENTITLEMENT") {
      setPaywallOpen("no_credits");
    }
  }, [state.error, isEmployee]);

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

  // When the engineer joins Zoom, dismiss the EngineerAssignedModal so the
  // customer can see the chat + inline Zoom card. We DELIBERATELY do not
  // call state.markJoined() here — the customer must click the green Join
  // button in the Zoom card themselves so their customer_joined_at only
  // stamps once they've actually opened the meeting. Otherwise their chat
  // card would flip to "Joined" the instant the engineer arrived, even if
  // they never opened Zoom.
  useEffect(() => {
    if (accepted) return;
    if (!state.session) return;
    if (!shouldShowIncomingCall(state.session)) return;
    setAccepted(true);
  }, [
    state.session?.id,
    state.session?.engineer_joined_at,
    state.session?.zoom_meeting_id,
    state.session?.customer_joined_at,
    state.session?.status,
    accepted,
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
  // Global "New chat" modal (§1.4): pick a project to chat about or add one.
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  // Reload the project list whenever auth changes or a session ends —
  // ending one may add a new project (since create happens at session start).
  const refetchProjects = useCallback(async () => {
    if (state.auth.kind !== "authed") return;
    const sb = createClient();
    const { data, error } = await sb
      .from("projects")
      .select("id, name, created_at, ai_summary_title, ai_summary_overview, ai_next_steps, summary, summary_updated_at")
      .eq("customer_id", state.auth.userId)
      .order("created_at", { ascending: false });
    if (error) return;
    setProjects((data ?? []).map((r) => ({
      id:                r.id as string,
      name:              r.name as string,
      createdAt:         r.created_at as string,
      aiSummaryTitle:    (r.ai_summary_title as string | null) ?? null,
      aiSummaryOverview: (r.ai_summary_overview as string | null) ?? null,
      aiNextSteps:       (Array.isArray(r.ai_next_steps) ? (r.ai_next_steps as string[]) : null),
      summary:           (r.summary as string | null) ?? null,
      summaryUpdatedAt:  (r.summary_updated_at as string | null) ?? null,
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

  // First-time customers used to auto-open the project-name form here so
  // they'd be funneled straight into creating a session. That gave them a
  // different first-render UX than returning customers (who see the
  // branded landing with the "Start a session" CTA). Per product call:
  // both audiences should land on the same branded screen, so the
  // auto-open is disabled — the CTA on the landing handles the new-session
  // funnel uniformly.

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

  // Picker-pane handlers — both funnel into /intake. The wizard at
  // /intake?projectId=X detects an existing intake (returning user picking
  // an old project) and short-circuits straight into match_engineer +
  // matching screen; otherwise it collects answers.
  const handleProjectConfirmNew  = useCallback(async (_name: string) => {
    setProjectFormOpen(false);
    router.push("/intake");
  }, [router]);
  const handleProjectConfirmPick = useCallback(async (id: string) => {
    setProjectFormOpen(false);
    router.push(`/intake?projectId=${id}`);
  }, [router]);

  // Called from sidebar's "+ inside project" affordance AND from the
  // branded landing's CTA when a project is selected. Both new and
  // existing projects now go through the same push-ring matching flow:
  //
  //   no project        → /intake (wizard creates project + intake + match)
  //   project, intake?  → look up the project's intake. If present, mint a
  //                        session, point the intake at it (clearing
  //                        declined_by so engineers can re-ring), and fire
  //                        match_engineer. Redirect to the matching screen.
  //                        If absent, route to /intake?projectId=X so the
  //                        customer can fill the answers once (legacy
  //                        projects predate per-project intake).
  const handleStartInProject = useCallback(async (projectId: string | null) => {
    // Don't let the customer ring a new engineer while already on a call.
    if (blockNewCall()) return;
    // Entitlement check before we do anything else. Employees route
    // around it — their minutes come from the dept allocation, not the
    // personal entitlement, and the paywall doesn't apply to them.
    if (!isEmployee) {
      const hasFreeLeft = !state.entitlement.free_consumed_at;
      const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
      if (!hasFreeLeft && !hasPaidLeft) {
        setPaywallOpen("no_credits");
        return;
      }
    }
    setViewingPastId(null);
    setPendingDraft(null);
    setSelectedProjectId(null);

    if (!projectId) {
      // Fresh project → wizard. It creates the project, writes the intake,
      // mints the session, fires match_engineer, and redirects to /intake/matching.
      router.push("/intake");
      return;
    }

    const sb = createClient();
    const userId = state.auth.kind === "authed" ? state.auth.userId : null;
    if (!userId) {
      router.push("/login?next=/room");
      return;
    }

    // Does this project already have an intake?
    const { data: intake } = await sb
      .from("client_intakes")
      .select("id")
      .eq("project_id", projectId)
      .eq("customer_user_id", userId)
      .maybeSingle();
    if (!intake) {
      router.push(`/intake?projectId=${projectId}`);
      return;
    }

    // Existing intake → start session + match, then off to the waiting screen.
    // Cancel any lingering active session in a different project first.
    const { data: activeSessions } = await sb
      .from("guest_calls")
      .select("id, project_id")
      .eq("customer_user_id", userId)
      .in("status", ["queued","assigned","joining","live","grace","ending","expired_free"])
      .order("created_at", { ascending: false })
      .limit(1);
    const lingering = (activeSessions ?? [])[0] as { id: string; project_id: string | null } | undefined;
    if (lingering && lingering.project_id !== projectId) {
      await sb.rpc("cancel_customer_session", { _session_id: lingering.id });
    }

    const { data: callData, error: callErr } = await sb.rpc(
      "get_or_create_active_customer_session",
      { _project_id: projectId },
    );
    if (callErr) {
      if ((callErr.message ?? "").includes("NO_ENTITLEMENT")) {
        // Same rule as the pre-check: only open the paywall for
        // non-employees. Employees get a silent log; the dept admin is
        // the right escalation path.
        if (!isEmployee) setPaywallOpen("no_credits");
        else console.warn("[handleStartInProject] employee hit NO_ENTITLEMENT — dept pool likely exhausted");
        return;
      }
      console.warn("[handleStartInProject] session mint failed:", callErr.message);
      return;
    }
    const session = (Array.isArray(callData) ? callData[0] : callData) as { id: string } | null;
    if (!session?.id) return;

    // Point the intake at the new session and clear declined_by so we can
    // re-ring engineers who said no last time.
    await sb.from("client_intakes")
      .update({ guest_call_id: session.id, declined_by: [] })
      .eq("id", intake.id);

    await sb.rpc("match_engineer", { _intake_id: intake.id });
    // Hop to the full-page matching screen (chat-while-ringing + restyled
    // chrome). On accept, MatchingClient redirects back to /room.
    router.replace(`/intake/matching/${intake.id}`);
  }, [state.entitlement, state.auth, router, isEmployee, blockNewCall]);

  // Toggle a project as the current "context" for the no-session landing.
  // Passing the same id again clears it. General has no real id, so it
  // can't be selected (handled at the sidebar level).
  const handleSelectProject = useCallback((projectId: string | null) => {
    setSelectedProjectId((prev) => (prev === projectId ? null : projectId));
  }, []);

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
    // Don't let the customer ring a new engineer while already on a call.
    if (blockNewCall()) return;
    // Employees bypass the credits gate (dept pool, not personal
    // entitlement). Non-employees see the paywall when both buckets dry.
    if (!isEmployee && freeConsumed && paidRemaining <= 0) {
      setPaywallOpen("no_credits");
      return;
    }
    setViewingPastId(null);
    setPendingDraft(null);
    // "New session" — LIVE engineer path. Intake → ring → engineer joins
    // in seconds. Same as before; this is the "I'm stuck, ring someone
    // now" entry point.
    router.push("/intake");
  }, [freeConsumed, paidRemaining, router, isEmployee, blockNewCall]);

  // "New chat" — ASYNC support path. No ringing overlay on customer side,
  // but the session MUST be visible to engineers (so they can claim it
  // off-line). Same mint pipeline as a normal session — just skip the
  // ConnectingModal client-side via ?newchat=1.
  //
  // // TODO(api): introduce a real `intake_mode` column on guest_calls so
  // the backend can distinguish "ring now" vs "async queue" requests.
  // Today we lean on the same match_engineer pipeline; the engineer's
  // dashboard surfaces this exactly like a queued call. The customer
  // sees the AsyncChatPane instead of the calling modal.
  const handleNewChat = useCallback(async () => {
    if (!isEmployee && freeConsumed && paidRemaining <= 0) {
      setPaywallOpen("no_credits");
      return;
    }
    setViewingPastId(null);
    setPendingDraft(null);

    const sb = createClient();
    const userId = state.auth.kind === "authed" ? state.auth.userId : null;
    if (!userId) {
      router.push("/login?next=/room");
      return;
    }
    try {
      // 1. Pick a project — reuse profile.lastProjectId if present,
      //    otherwise create a fresh "Chat" project.
      const profile = readProfile();
      let projectId = profile.lastProjectId ?? null;
      let projectName = profile.lastProjectName ?? null;

      if (!projectId) {
        const { data: created, error: projErr } = await sb.rpc(
          "create_project",
          { _name: "Chat" },
        );
        if (projErr) throw projErr;
        const row = Array.isArray(created)
          ? (created[0] as { id?: string; name?: string } | null)
          : (created as { id?: string; name?: string } | null);
        projectId = row?.id ?? null;
        projectName = row?.name ?? "Chat";
        if (!projectId) throw new Error("Could not create chat project");
      }

      // 2. Cancel any lingering active session in a different project.
      const { data: actives } = await sb
        .from("guest_calls")
        .select("id, project_id")
        .eq("customer_user_id", userId)
        .in("status", ["queued", "assigned", "joining", "live", "grace", "ending", "expired_free"])
        .order("created_at", { ascending: false })
        .limit(1);
      const lingering = (actives ?? [])[0] as { id: string; project_id: string | null } | undefined;
      if (lingering && lingering.project_id !== projectId) {
        await sb.rpc("cancel_customer_session", { _session_id: lingering.id });
      }

      // 3. Mint / re-use the session.
      const { data: callData, error: rpcErr } = await sb.rpc(
        "get_or_create_active_customer_session",
        { _project_id: projectId },
      );
      if (rpcErr) {
        if ((rpcErr.message ?? "").includes("NO_ENTITLEMENT")) {
          setPaywallOpen("no_credits");
          return;
        }
        throw rpcErr;
      }
      const session = (Array.isArray(callData) ? callData[0] : callData) as { id?: string } | null;
      if (!session?.id) throw new Error("Could not create session");

      // 4. Upsert a minimal intake row (uses the profile snapshot if
      //    present) so engineer-side queue + matching has the context
      //    it needs. // TODO(api): widen ai_tools_used to text[].
      const familiarity =
        profile.techComfort === "well_experienced"
          ? "Well Experienced"
          : profile.techComfort === "semi_technical"
            ? "Semi-Technical"
            : "Totally Unknown";
      const intakePayload = {
        guest_call_id: session.id,
        customer_user_id: userId,
        project_id: projectId,
        familiarity,
        ai_tools_used: profile.stack.aiTools.join(", ") || "Other",
        developing: "Website",
        technologies: [
          ...profile.stack.backend,
          ...profile.stack.frontend,
        ],
        declined_by: [] as string[],
      };
      const { data: intakeRow, error: intakeErr } = await sb
        .from("client_intakes")
        .upsert(intakePayload, { onConflict: "project_id,customer_user_id" })
        .select()
        .single();
      if (intakeErr) throw intakeErr;
      const intakeId = intakeRow.id as string;

      // 5. Fire match_engineer — this is what makes the engineer's
      //    /inbox + /dashboard surface the new call. The customer's
      //    ConnectingModal is suppressed by the ?newchat=1 flag, so
      //    they see the bot chat instead of the ringing card. Engineer
      //    side behavior is unchanged.
      await sb.rpc("match_engineer", { _intake_id: intakeId });

      patchProfile({
        lastProjectId: projectId,
        lastProjectName: projectName,
        userId,
      });
    } catch (e) {
      console.warn("[handleNewChat] failed:", e);
    }

    router.push("/room?newchat=1");
  }, [router, isEmployee, freeConsumed, paidRemaining, state.auth]);

  // Recharge / "see plans" handler. Always opens the paywall — even when
  // the user has credits — so the Recharge button in the profile menu is
  // a real top-up action, not just an out-of-credits gate.
  const handleWalletClick = useCallback(() => {
    setPaywallOpen("manual");
  }, []);

  const handleCloseViewPast = useCallback(() => setViewingPastId(null), []);
  const handleNeedsCredits  = useCallback(() => setPaywallOpen("no_credits"), []);
  const handleProjectCancel = useCallback(() => setProjectFormOpen(false), []);
  const handleRenameProject = useCallback(async (projectId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const sb = createClient();
    await sb.from("projects").update({ name: trimmed }).eq("id", projectId);
    // Mirror the rename onto any in-flight session row so the chat header,
    // sidebar count, and finance feed all see the same name.
    await sb.from("guest_calls").update({ project_name: trimmed }).eq("project_id", projectId);
    await refetchProjects();
  }, [refetchProjects]);
  const handleNeedProject   = useCallback((draft: string) => {
    // Composer typed-then-send before any session existed. Carry the draft
    // forward and start a session in a project named after the customer.
    setPendingDraft(draft);
    void startSessionInProject({ newName: "project" });
  }, [startSessionInProject]);

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
        employment={employment}
        viewingPastId={viewingPastId}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onViewPast={handleViewPast}
        onNewSession={handleNewSession}
        onNewChat={() => setNewChatModalOpen(true)}
        onStartInProject={handleStartInProject}
        onRenameProject={handleRenameProject}
        onSelectProject={handleSelectProject}
        onWalletClick={handleWalletClick}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating status / timer chip + end-meeting button (top-right) */}
        <FloatingStatus
          session={state.session}
          entitlement={state.entitlement}
          accepted={accepted}
          onEnd={state.end}
        />

        <main className="min-h-0 flex-1">
          {asyncChatMode ? (
            <AsyncChatPane
              onEscalateToCall={handleNewSession}
              onCloseAsyncMode={() => setAsyncChatMode(false)}
            />
          ) : (
          <MainPane
            state={state}
            accepted={accepted}
            employment={employment}
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
            onNewSession={handleNewSession}
            selectedProjectId={selectedProjectId}
            onSelectProject={handleSelectProject}
            onStartInProject={handleStartInProject}
          />
          )}
        </main>
      </div>

      {state.session && state.session.status !== "ended" && (
        <SessionSummaryTray session={state.session} />
      )}

      {/* Overlays */}
      {state.session?.status === "queued" && !asyncChatMode && (
        <ConnectingModal
          session={state.session}
          onRecall={state.recall}
          onCancel={state.cancel}
          projects={projects}
          onProjectsChanged={refetchProjects}
        />
      )}
      {state.session && shouldShowEngineerAssigned(state.session) && !accepted && (
        <EngineerAssignedModal
          engineerName={state.session.agent_name ?? "Your engineer"}
          onCancel={state.cancel}
        />
      )}
      {state.error && state.error !== "NO_ENTITLEMENT" && <ErrorToast message={state.error} />}
      {callBlockMsg && <ErrorToast message={callBlockMsg} />}
      {paidToast && <SuccessToast message={paidToast} />}

      <PaywallModal
        open={paywallOpen !== null}
        reason={paywallOpen ?? "manual"}
        onClose={() => setPaywallOpen(null)}
      />

      <GlobalNewChatModal
        open={newChatModalOpen}
        onClose={() => setNewChatModalOpen(false)}
        projects={projects}
        onPickProject={(id) => { setNewChatModalOpen(false); void handleStartInProject(id); }}
        onAddProject={() => { setNewChatModalOpen(false); router.push("/intake"); }}
        onAsyncChat={() => { setNewChatModalOpen(false); void handleNewChat(); }}
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

// Engineer has accepted the request (assigned) but the Zoom meeting hasn't
// been minted yet. We briefly show a "{engineer} is connecting with you"
// card so the customer isn't left with the queue's avg-wait timer ticking
// after the request was already picked up. As soon as the engineer's auto-
// mint completes (zoom_meeting_id set), the modal dismisses — the inline
// ZoomCallCard in the chat takes over as the join surface.
function shouldShowEngineerAssigned(s: GuestCall): boolean {
  return (
    s.status === "assigned" &&
    !s.zoom_meeting_id &&
    !s.engineer_joined_at &&
    !s.customer_joined_at
  );
}

// ── Main pane (state-driven) ───────────────────────────────────────────────
const MainPane = memo(function MainPane({
  state, accepted, employment, viewingPastId, onCloseViewPast, onNeedsCredits,
  projectFormOpen, pendingDraft, projects,
  onProjectConfirmNew, onProjectConfirmPick, onProjectCancel, onNeedProject,
  onNewSession, selectedProjectId, onSelectProject, onStartInProject,
}: {
  state: ReturnType<typeof useCustomerSession>;
  accepted: boolean;
  employment: EmployeeInfo | null;
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
  /** "Start a new session" — opens the project picker. Used by the
   *  branded landing CTA when there's no active session. */
  onNewSession: () => void;
  /** Currently-selected project id (or null). Drives the landing CTA. */
  selectedProjectId: string | null;
  /** Clear the project selection (passed null) — used by the landing's
   *  "× clear" affordance. */
  onSelectProject: (id: string | null) => void;
  /** Start a session directly in a given project (skips picker). */
  onStartInProject: (projectId: string | null) => void;
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

  // User clicked a past session in the sidebar — PastSessionReview owns
  // the full split (read-only chat | summary).
  if (viewingPastId) {
    return <PastSessionReview sessionId={viewingPastId} onClose={onCloseViewPast} />;
  }

  // Just-ended session: live chat (composer auto-locks via session.status
  // === "ended") on the left, summary-only sidebar on the right.
  if (session?.status === "ended") {
    return (
      <PanelGroup direction="horizontal" autoSaveId="relay-room-review" className="h-full">
        <Panel defaultSize={60} minSize={40} order={1}>
          <ChatPane state={state} fullWidth employment={employment} onNeedsCredits={onNeedsCredits} />
        </Panel>
        <Resizer />
        <Panel defaultSize={40} minSize={28} order={2}>
          <SummaryPanel session={session} messages={state.messages} />
        </Panel>
      </PanelGroup>
    );
  }

  // No active session (or stale cancelled / abandoned one). Show the
  // branded landing instead of the chat — the user starts a new session
  // from the CTA (or from the sidebar's + New session button).
  const inactive = !session || ["cancelled", "abandoned"].includes(session.status);
  if (inactive) {
    const selectedProject = selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId) ?? null
      : null;
    const customerEmail = state.auth.kind === "authed" ? state.auth.email : "";
    const customerUserId = state.auth.kind === "authed" ? state.auth.userId : null;
    const userName = customerEmail
      ? customerEmail.split("@")[0] || customerEmail
      : "you";
    return (
      <BrandedLanding
        onStartNewSession={onNewSession}
        selectedProject={selectedProject}
        onStartInProject={() => onStartInProject(selectedProjectId)}
        onClearSelectedProject={() => onSelectProject(null)}
        userName={userName}
        customerUserId={customerUserId}
      />
    );
  }

  // Active session — show the chat (composer also handles new-session
  // creation as a fallback path via onNeedProject).
  return <ChatPane state={state} fullWidth employment={employment} onNeedsCredits={onNeedsCredits} onNeedProject={onNeedProject} />;
});

// Branded "empty" landing shown when no session is active. Wordmark +
// tagline + CTA in the centre; a collapsible right-side panel surfaces
// the contextual AI summary:
//   • no project selected → customer-level rollup (all projects together)
//   • project selected    → that project's rollup (all its sessions)
// Header reads "RELAY × {name}" or "{Project} × {name}" to anchor scope.
//
// When a project is selected in the sidebar, the CTA also switches to
// "Start a session in {project name}" and clicking it mints directly
// in that project; a small × clears the selection back to the generic
// "Start a new session" flow.
function BrandedLanding({
  onStartNewSession, selectedProject, onStartInProject, onClearSelectedProject,
  userName, customerUserId,
}: {
  onStartNewSession: () => void;
  selectedProject: Project | null;
  onStartInProject: () => void;
  onClearSelectedProject: () => void;
  userName: string;
  customerUserId: string | null;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const hasProject = !!selectedProject;

  // Customer-level summary (only used when no project is selected).
  type CustomerSummary = {
    aiSummaryTitle: string | null;
    aiSummaryOverview: string | null;
    aiNextSteps: string[] | null;
    summaryUpdatedAt: string | null;
  };
  const [customerSummary, setCustomerSummary] = useState<CustomerSummary | null>(null);
  const [customerSummaryLoading, setCustomerSummaryLoading] = useState(false);

  useEffect(() => {
    if (!customerUserId || hasProject) return;
    let cancelled = false;
    setCustomerSummaryLoading(true);
    void (async () => {
      const sb = createClient();
      const { data } = await sb
        .from("customer_summaries")
        .select("ai_summary_title, ai_summary_overview, ai_next_steps, summary_updated_at")
        .eq("customer_id", customerUserId)
        .maybeSingle();
      if (cancelled) return;
      setCustomerSummary(
        data
          ? {
              aiSummaryTitle: (data.ai_summary_title as string | null) ?? null,
              aiSummaryOverview: (data.ai_summary_overview as string | null) ?? null,
              aiNextSteps: Array.isArray(data.ai_next_steps) ? (data.ai_next_steps as string[]) : null,
              summaryUpdatedAt: (data.summary_updated_at as string | null) ?? null,
            }
          : null,
      );
      setCustomerSummaryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [customerUserId, hasProject]);

  // Resolve what to render in the right rail based on selection.
  const panelTitle = hasProject
    ? selectedProject!.name
    : "RELAY";
  const panelSummaryTitle = hasProject
    ? selectedProject!.aiSummaryTitle
    : customerSummary?.aiSummaryTitle ?? null;
  const panelSummaryOverview = hasProject
    ? selectedProject!.aiSummaryOverview
    : customerSummary?.aiSummaryOverview ?? null;
  const panelNextSteps = hasProject
    ? selectedProject!.aiNextSteps
    : customerSummary?.aiNextSteps ?? null;
  const panelEmptyHint = hasProject
    ? "A summary will appear here once a session in this project ends."
    : "A summary will appear here once your first session ends.";
  const showLoading = !hasProject && customerSummaryLoading && !customerSummary;

  return (
    <div className="relative flex h-full w-full">
      {/* Atmospheric top glow — quiet brand presence on the dashboard. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(ellipse at top, color-mix(in srgb, var(--green-dot) 10%, transparent), transparent 70%)",
        }}
      />

      {/* Centre: branded hero */}
      <div className="relative flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center text-center">
          <Wordmark size="lg" />
          <h1 className="mt-6 font-serif text-3xl font-medium leading-tight tracking-tight text-[var(--text)] sm:text-4xl">
            Real engineers, ninety seconds away.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
            A qualified human joins your chat + Zoom call in ~90 seconds. Tap below to start.
          </p>

          {hasProject ? (
            <>
              <div className="mt-7 inline-flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 shadow-sm">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                  <Folder size={16} />
                </div>
                <div className="flex min-w-0 flex-col items-start text-left">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Working in
                  </span>
                  <span
                    className="max-w-[220px] truncate text-base font-semibold leading-tight text-[var(--text)]"
                    title={selectedProject!.name}
                  >
                    {selectedProject!.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onClearSelectedProject}
                  className="ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]"
                  aria-label="Clear selected project"
                  title="Clear project"
                >
                  <X size={13} />
                </button>
              </div>
              <Button
                variant="launcher"
                size="xl"
                onClick={onStartInProject}
                iconLeft={<Plus size={16} />}
                className="mt-5"
              >
                Start session in {selectedProject!.name}
              </Button>
            </>
          ) : (
            <Button
              variant="launcher"
              size="xl"
              onClick={onStartNewSession}
              iconLeft={<Plus size={16} />}
              className="mt-7"
            >
              Get an engineer now
            </Button>
          )}

          <p className="mt-4 text-xs text-[var(--text-faint)]">
            Chat + Zoom. No installs. Pay only for time you use.
          </p>
        </div>
      </div>

      {/* Right rail: contextual AI summary (customer-level or project-level). */}
      <aside
        className="flex h-full shrink-0 flex-col border-l transition-[width] duration-200"
        style={{
          width: sidebarCollapsed ? 48 : 320,
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          {!sidebarCollapsed && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {hasProject ? (
                <Folder size={12} style={{ color: BRAND_GREEN, flexShrink: 0 }} />
              ) : null}
              <span
                className="min-w-0 truncate text-[12px] font-semibold uppercase tracking-[0.06em]"
                style={{ color: "var(--text)" }}
                title={`${panelTitle} × ${userName}`}
              >
                {panelTitle}
                <span style={{ color: "var(--text-muted)", margin: "0 6px" }}>×</span>
                <span style={{ color: BRAND_GREEN, textTransform: "none" }}>{userName}</span>
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className={`flex h-7 w-7 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 ${sidebarCollapsed ? "mx-auto" : ""}`}
            style={{ color: "var(--text-muted)" }}
            aria-label={sidebarCollapsed ? "Expand summary panel" : "Collapse summary panel"}
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            {sidebarCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {showLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
                <span className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Loading summary…
                </span>
              </div>
            ) : panelSummaryOverview || panelSummaryTitle ? (
              <div className="space-y-4 max-w-prose">
                {panelSummaryTitle ? (
                  <h2 className="font-serif text-lg font-medium leading-tight tracking-tight text-[var(--text)]">
                    {panelSummaryTitle}
                  </h2>
                ) : null}
                {panelSummaryOverview ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text)]">
                    {panelSummaryOverview}
                  </p>
                ) : null}
                {Array.isArray(panelNextSteps) && panelNextSteps.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Next steps
                    </h3>
                    <ul className="space-y-2">
                      {panelNextSteps.map((step, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-[13px] leading-relaxed text-[var(--text)]"
                        >
                          <ChevronRight
                            size={14}
                            className="mt-0.5 shrink-0 text-[var(--primary)]"
                          />
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                compact
                icon={<Sparkles size={20} className="text-[var(--primary)]" />}
                title="No summary yet"
                body={panelEmptyHint}
              />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// Past session view — split layout owned by this component:
//   • Left  → read-only chat with the past session's messages (composer
//             disabled; meeting cards render inline same as live chat).
//   • Right → AI summary only (no Chat-history tab; the chat lives in
//             the main pane now, so duplicating it in the sidebar would
//             just add clutter).
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
      <div className="flex h-full items-center justify-center" style={{ backgroundColor: "var(--surface)" }}>
        <Loader2 size={18} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" autoSaveId="relay-room-past" className="h-full">
      <Panel defaultSize={60} minSize={40} order={1}>
        <ReadOnlyChatPane messages={msgs} session={row} />
      </Panel>
      <Resizer />
      <Panel defaultSize={40} minSize={28} order={2}>
        <SummaryPanel session={row} messages={msgs} onClose={onClose} />
      </Panel>
    </PanelGroup>
  );
}

// Read-only chat pane used for past + just-ended sessions where there's
// nothing to send. Renders messages the same way as the live ChatPane
// (with inline MeetingChatEntry cards) and shows a locked-state hint in
// place of the composer.
function ReadOnlyChatPane({
  messages,
  session,
}: {
  messages: GuestMessage[];
  session: GuestCall;
}) {
  const router = useRouter();
  const [resumeBusy, setResumeBusy] = useState<"continue" | "follow_up" | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const resumeInProject = useCallback(
    async (mode: "continue" | "follow_up") => {
      if (resumeBusy) return;
      setResumeBusy(mode);
      setResumeError(null);
      try {
        // Stash resume context so the in-chat AI assistant opens with a
        // context-aware "Welcome back / what's changed?" prompt.
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              "relay-resume-context",
              JSON.stringify({
                mode,
                fromSessionId: session.id,
                projectId: session.project_id ?? null,
                projectName: session.project_name ?? null,
                aiSummaryTitle: session.ai_summary_title ?? null,
                aiSummary: session.ai_summary_overview ?? null,
                aiNextSteps: session.ai_next_steps ?? null,
                savedAt: Date.now(),
              }),
            );
          }
        } catch { /* swallow quota / privacy mode */ }
        if (session.project_id) {
          patchProfile({
            lastProjectId: session.project_id,
            lastProjectName: session.project_name ?? null,
            userId: session.customer_user_id ?? null,
          });
        }

        // UI-only restart — drop the user into async-chat mode for this
        // project. NO new session is minted here; that costs an
        // entitlement and the customer may have exhausted it on the
        // ended session. The async chat surface keeps the prominent
        // green call button at the top — when the customer wants a live
        // engineer they tap it and the standard /intake → ring flow
        // (which DOES gate on entitlement / paywall) takes over.
        //
        // // TODO(api): true in-place reopen of the ended session
        // without re-minting / re-charging. Server contract: allow
        // re-activating a same-project session within a grace window.
        router.push(`/room?newchat=1`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        console.warn("[resumeInProject]", msg);
        setResumeError(msg);
        setResumeBusy(null);
      }
    },
    [session, resumeBusy, router],
  );

  const isSupervisor = useIsSupervisor();
  const meetingEnded = new Map<string, GuestMessage>();
  const meetingSummary = new Map<string, GuestMessage>();
  const meetingRecording = new Map<string, GuestMessage>();
  const suppressedEndedIds = new Set<string>();
  const suppressedSummaryIds = new Set<string>();
  const suppressedRecordingIds = new Set<string>();
  {
    const queue: GuestMessage[] = [];
    // Most recently ended meeting (its "started" id) still accepting trailing
    // attachments. Stays alive across summary + recording arrivals (they can
    // come in either order) and only resets on the next "started" so a
    // stray attachment doesn't get pinned onto a finished cycle.
    let lastEndedStartId: string | null = null;
    for (const m of messages) {
      if (m.sender_kind !== "system") continue;
      if ((m.body ?? "").includes("Zoom meeting started")) {
        queue.push(m);
        lastEndedStartId = null;
      } else if ((m.body ?? "").includes("Zoom meeting ended")) {
        const start = queue.shift();
        if (start) {
          meetingEnded.set(start.id, m);
          suppressedEndedIds.add(m.id);
          lastEndedStartId = start.id;
        }
      } else if (m.body && isAiSummaryMessageBody(m.body) && lastEndedStartId) {
        meetingSummary.set(lastEndedStartId, m);
        suppressedSummaryIds.add(m.id);
      } else if (m.body && m.body.includes("Recording available") && lastEndedStartId) {
        meetingRecording.set(lastEndedStartId, m);
        suppressedRecordingIds.add(m.id);
      }
    }
  }

  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No messages in this session.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.flatMap((m) => {
                if (isSupervisorOnlyMessage(m) && !isSupervisor) return [];
                if (m.sender_kind === "system" && (m.body ?? "").includes("Zoom meeting started")) {
                  const ended = meetingEnded.get(m.id) ?? null;
                  const summary = meetingSummary.get(m.id) ?? null;
                  const recording = meetingRecording.get(m.id) ?? null;
                  const durationSec = ended
                    ? Math.floor((new Date(ended.created_at).getTime() - new Date(m.created_at).getTime()) / 1000)
                    : undefined;
                  // All meetings in a past session are over by definition,
                  // so the card always renders in its ended state.
                  return [
                    <MeetingChatEntry
                      key={m.id}
                      active={false}
                      durationSec={durationSec}
                      summaryBody={summary?.body ?? null}
                      recordingBody={isSupervisor ? recording?.body ?? null : null}
                    />,
                  ];
                }
                if (m.sender_kind === "system" && suppressedEndedIds.has(m.id)) {
                  return [];
                }
                if (m.sender_kind === "system" && suppressedSummaryIds.has(m.id)) {
                  return [];
                }
                if (m.sender_kind === "system" && suppressedRecordingIds.has(m.id)) {
                  return [];
                }
                return [<Message key={m.id} message={m} />];
              })}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-6 pt-2">
        <div className="mx-auto w-full max-w-3xl">
          {/* FIX 4 — replaces the bare read-only pill with a real action
              bar so stale sessions are revivable. "Continue this session"
              re-opens the same project for a fresh ring with the prior
              context handed to the AI assistant. "Start a follow-up" mints
              a new session pre-seeded with the same project. */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-1.5">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[var(--text-muted)]">
                <Lock size={11} />
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Session ended
              </span>
            </div>
            <h3 className="mb-1 font-serif text-lg text-[var(--text)]">
              Pick up where you{" "}
              <em className="not-italic italic text-[var(--primary)]">left off</em>
              .
            </h3>
            <p className="mb-4 text-sm leading-relaxed text-[var(--text-muted)]">
              We'll re-ring an engineer in this same project with the
              context you've already given us.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="primary"
                size="lg"
                full
                loading={resumeBusy === "continue"}
                disabled={resumeBusy !== null}
                onClick={() => void resumeInProject("continue")}
                iconLeft={<RefreshCw size={14} />}
              >
                Continue this session
              </Button>
              <Button
                variant="secondary"
                size="lg"
                full
                loading={resumeBusy === "follow_up"}
                disabled={resumeBusy !== null}
                onClick={() => void resumeInProject("follow_up")}
                iconLeft={<Plus size={14} />}
              >
                Start a follow-up session
              </Button>
            </div>
            {resumeError && (
              <p className="mt-3 text-xs text-[var(--risk)]" role="alert">
                {resumeError}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// Summary-only sidebar for past + just-ended sessions. Replaces the older
// ReviewPanel that tabbed between Summary and Chat history — chat history
// now lives in the main chat pane, so the sidebar focuses on the AI summary.
function SummaryPanel({ session, messages, onClose }: { session: GuestCall; messages: GuestMessage[]; onClose?: () => void }) {
  return (
    <section
      className="flex h-full flex-col border-l"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <Sparkles size={12} style={{ color: BRAND_GREEN }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text)" }}>
          Summary
        </span>
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
      <SummaryView session={session} messages={messages} />
    </section>
  );
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


// ── Floating status chip (top-right) ───────────────────────────────────────
// Owns its own session timer so the 1-second tick stays local to this
// subtree instead of cascading from RoomClient down to Sidebar/MainPane/etc.
const FloatingStatus = memo(function FloatingStatus({
  session, entitlement, accepted, onEnd,
}: {
  session: GuestCall | null;
  entitlement: { free_consumed_at: string | null; paid_minutes_remaining: number };
  accepted: boolean;
  onEnd: (reason?: string) => Promise<void>;
}) {
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Hide entirely when there's nothing useful to show (idle, no session).
  // Timer shows from the moment the engineer accepts (status='assigned') —
  // chat starts then, and the free cap counts from there (chat + Zoom combined).
  const showTimer =
    !!session &&
    !!session.assigned_at &&
    !["ended", "cancelled", "abandoned", "queued"].includes(session.status);
  const showStatus = !!session && !["ended","cancelled","abandoned"].includes(session.status);
  // End button: visible from the moment the engineer claims the session.
  // Chat is live from 'assigned' onward (the timer's anchor too — see
  // useFreeSessionLifecycle), so the customer should be able to end at
  // any point during an active session — they don't have to first click
  // Join in the Zoom card.
  const showEnd = !!session && [
    "assigned", "joining", "live", "grace", "ending", "expired_free",
  ].includes(session.status);
  void accepted; // no longer gates End; kept for future re-use if needed
  if (!showTimer && !showStatus && !showEnd) return null;

  return (
    <>
      {/* Live-call HUD lives in normal flow at the top of the main column —
       *  it's a slim header bar, not an overlay. That way the chat /
       *  Zoom content below starts BELOW the HUD instead of being clipped
       *  by it. A subtle bottom border keeps it visually separate from the
       *  content without needing a backdrop blur. */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        {/* Session title (left) — picks the AI-summary title or a friendly
            fallback so the chat header always has a clear identity. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate font-serif text-base font-medium text-[var(--text)]">
            {session?.ai_summary_title || (session?.status === "queued" ? "Finding your engineer…" : "Session")}
          </h2>
        </div>

        {showTimer && (
          <LiveTimer
            joinedAt={session!.assigned_at ?? session!.joined_at ?? null}
            freeMinutes={session!.free_minutes ?? 10}
            isFreeSession={entitlement.free_consumed_at == null}
            paidExtensionAt={session!.paid_extension_at ?? null}
          />
        )}

        {showTimer && showStatus && (
          <span aria-hidden className="h-5 w-px" style={{ backgroundColor: "var(--border)" }} />
        )}

        {showStatus && session && <CompactStatus session={session} />}

        {/* Prominent green CALL button — required by the mock. Visible
            whenever a session is active. Joins Zoom if the engineer has
            minted the meeting; otherwise tooltipped as waiting. */}
        {showStatus && session && (
          <>
            <span aria-hidden className="h-5 w-px" style={{ backgroundColor: "var(--border)" }} />
            <CallHeaderActions session={session} />
          </>
        )}

        {showEnd && (
          <button
            onClick={() => setConfirmEnd(true)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--risk)" }}
          >
            <PhoneOff size={12} />
            End session
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

// CallHeaderActions — the prominent green circular Call button + add-
// participant + overflow icons in the chat header. Required by the
// room-w.png mock as the most obvious header control. The call button is
// enabled the moment the engineer mints a Zoom meeting; before that it's
// tooltipped as waiting so the user knows what to expect.
function CallHeaderActions({ session }: { session: GuestCall }) {
  const hasZoom = !!session.zoom_meeting_id;
  const isLiveish = ["assigned", "joining", "live", "grace"].includes(session.status);
  const canJoin = hasZoom && isLiveish;
  const tooltip = canJoin
    ? "Join the call"
    : isLiveish
      ? "Waiting for your engineer to start the call"
      : "Call starts once an engineer joins";

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        aria-label={tooltip}
        title={tooltip}
        variant="primary"
        size="md"
        disabled={!canJoin}
        onClick={() => {
          // Customer-side "join" is implicit — markJoined is called via
          // the existing ZoomJoinCard onJoin path inside ChatPane. Clicking
          // this header button scrolls the user to that card.
          const card = document.querySelector('[data-relay-zoom-card]');
          if (card && card.scrollIntoView) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }}
      >
        <Video size={16} />
      </IconButton>
      <IconButton
        aria-label="Add participant"
        title="Add participant (coming soon)"
        variant="ghost"
        size="md"
        disabled
      >
        <UserPlus size={15} />
      </IconButton>
      <IconButton
        aria-label="More actions"
        title="More"
        variant="ghost"
        size="md"
      >
        <MoreHorizontal size={15} />
      </IconButton>
    </div>
  );
}

// Live timer text — bold mono digits + a mode-appropriate suffix.
//   free_countdown  10:00 → 00:00, "free" (green) / "left" (amber <90s) / "Expired" (red)
//   paid_elapsed    00:00 → ∞, "paid" (green)
// The free timer permanently disappears once the customer's free quota is
// consumed OR a paid extension is stamped on this session — both cases
// route to paid_elapsed.
function LiveTimer({
  joinedAt, freeMinutes, isFreeSession, paidExtensionAt,
}: {
  joinedAt: string | null;
  freeMinutes: number;
  isFreeSession: boolean;
  paidExtensionAt: string | null;
}) {
  const timer = useSessionTimer({ joinedAt, freeMinutes, isFreeSession, paidExtensionAt });
  if (timer.mode === "hidden") return null;

  const isFree = timer.mode === "free_countdown";
  const color = isFree
    ? (timer.isExpired ? CRIT_RED : timer.isWarning ? URGENT_AMBER : BRAND_GREEN)
    : BRAND_GREEN;
  const suffix = isFree
    ? (timer.isExpired ? "Expired" : timer.isWarning ? "left" : "free")
    : "paid";

  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs font-medium">
      <span
        className="font-semibold tabular-nums"
        style={{ fontFamily: "var(--font-inter)", color, fontSize: 13 }}
      >
        {timer.display}
      </span>
      <span style={{ color: "var(--text-muted)" }}>{suffix}</span>
    </span>
  );
}

// Compact "● LIVE" indicator that fits next to the timer. Reuses the same
// label/color mapping from the full StatusPill but without the chip border.
function CompactStatus({ session }: { session: GuestCall }) {
  const cfg = pillConfig(session.status, session.urgency);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: cfg.fg }}>
      <span className="relative flex h-2 w-2">
        {cfg.pulse && (
          <span
            className="absolute inset-0 rounded-full opacity-70"
            style={{ backgroundColor: cfg.fg, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }}
          />
        )}
        <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: cfg.fg }} />
      </span>
      {cfg.label}
    </span>
  );
}

function ConfirmEndModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={busy ? () => {} : onCancel}
      title="End this session?"
      description="The video call will close and we'll generate a summary. You can't resume after ending."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Keep going
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            iconLeft={!busy ? <PhoneOff size={14} /> : null}
          >
            End session
          </Button>
        </>
      }
    >
      <div className="flex justify-center">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-[var(--risk-soft)] text-[var(--risk)]">
          <PhoneOff size={20} />
        </div>
      </div>
    </Modal>
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
  // "Connecting" = pre-claim queue wait. From assigned onwards the session
  // is "Live" (chat works, timer ticking), then "Joining call" while Zoom
  // is mounting, then "On call" once both are in the meeting.
  if (status === "queued")    return { label: "Connecting",      bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "assigned")  return { label: "Live",            bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "joining")   return { label: "Joining call",    bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "live")      return { label: "On call",         bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
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
  /** AI roll-up across every session in the project; populated by
   *  summarize-project on session end. Null until first cascade runs. */
  aiSummaryTitle: string | null;
  aiSummaryOverview: string | null;
  aiNextSteps: string[] | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
};

type ProjectGroup = {
  key: string;           // projectId or "general"
  name: string;          // display name
  sessions: PastSession[];
  latestDate: number;    // ms timestamp — used for sorting
};

const Sidebar = memo(function Sidebar({
  email, customerUserId, session, entitlement, employment, viewingPastId, projects,
  selectedProjectId, onViewPast, onNewSession, onNewChat, onStartInProject, onRenameProject, onSelectProject, onWalletClick,
}: {
  email: string;
  customerUserId: string | null;
  session: GuestCall | null;
  entitlement: { free_consumed_at: string | null; free_minutes_used: number; paid_minutes_remaining: number };
  employment: EmployeeInfo | null;
  viewingPastId: string | null;
  projects: Project[];
  /** Currently-selected project (or null). Highlighted in the sidebar
   *  and drives the branded landing's CTA. */
  selectedProjectId: string | null;
  onViewPast: (id: string | null) => void;
  /** Top-level "+ New session" — opens picker that lets the user pick a
   *  project (existing or new) before the session is created. */
  onNewSession: () => void;
  /** "New chat" — async support path. No ring, immediate bot greeting. */
  onNewChat: () => void;
  /** Inline "+" inside a project row — starts a session bound to that
   *  exact project, skipping the picker. */
  onStartInProject: (projectId: string | null) => void;
  /** Inline rename on a project row. Updates projects.name + any active
   *  guest_calls.project_name in flight. */
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  /** Click on a project header — toggle that project as the current
   *  context for the no-session landing. Same id toggles off. */
  onSelectProject: (projectId: string | null) => void;
  onWalletClick: () => void;
}) {
  // Sidebar starts EXPANDED by default (Order 1 of the Commander brief —
  // Projects expanded, every action labelled, no mystery icons). User can
  // still collapse for the visit. Persistence intentionally NOT kept so
  // returning users see the full hierarchy on each fresh /room landing.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const toggleCollapsed = (next: boolean) => setCollapsed(next);

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

      // Pull intake.intake_summary + first_user_message for each session
      // so the auto-name can reach beyond ai_summary_title to derive a
      // proper topic-based name. Best-effort: failures fall back to the
      // existing priority list. // TODO(api): denormalise an intake_topic
      // text column onto guest_calls so this extra query goes away.
      const sessionIds = rows.map((r) => r.id as string);
      const intakesByCall = new Map<string, { problem: string | null; summary: string | null }>();
      if (sessionIds.length > 0) {
        const { data: intakes } = await sb
          .from("client_intakes")
          .select("guest_call_id, intake_summary")
          .in("guest_call_id", sessionIds);
        for (const row of (intakes ?? []) as Array<{
          guest_call_id: string | null;
          intake_summary: string | null;
        }>) {
          if (row.guest_call_id) {
            intakesByCall.set(row.guest_call_id, {
              problem: null,
              summary: row.intake_summary ?? null,
            });
          }
        }
        // First customer message per session — short topic fallback.
        const { data: firstMsgs } = await sb
          .from("guest_messages")
          .select("guest_call_id, body, created_at, sender_kind")
          .in("guest_call_id", sessionIds)
          .eq("sender_kind", "guest")
          .order("created_at", { ascending: true });
        const seen = new Set<string>();
        for (const m of (firstMsgs ?? []) as Array<{
          guest_call_id: string;
          body: string;
        }>) {
          if (seen.has(m.guest_call_id)) continue;
          seen.add(m.guest_call_id);
          const existing = intakesByCall.get(m.guest_call_id) ?? {
            problem: null,
            summary: null,
          };
          intakesByCall.set(m.guest_call_id, {
            ...existing,
            problem: m.body ?? null,
          });
        }
      }

      setPast(rows.map((row) => {
        const status = row.status as SessionStatus;
        // Synthesise a label for sessions that don't have an AI summary yet
        // (active ones, or summary generation pending). The status hint
        // helps the customer find a specific session.
        // FIX 2 + follow-up — no session is named after its status.
        // Topic priority for the auto-name:
        //   1. ai_summary_title       (AI-generated post-call title)
        //   2. intake_summary headline (LLM intake brief)
        //   3. first user message (truncated, sentence-cased)
        //   4. project_name + timestamp
        //   5. "Session · {date}, {time}"
        // // TODO(ai): improve via OpenAI against the full intake transcript
        // when ai_summary_title is missing for short sessions.
        const created = row.created_at as string;
        const projectNameRaw = (row.project_name as string | null) ?? null;
        const aiTitle = row.ai_summary_title as string | null;
        const intakeBlob = intakesByCall.get(row.id as string);
        const intakeHeadline =
          intakeBlob?.summary
            ? intakeBlob.summary.split("\n").map((s) => s.trim()).find(Boolean) ?? null
            : null;
        const firstMsgRaw = intakeBlob?.problem ?? null;
        const friendlyDate = new Date(created).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        const friendlyTime = new Date(created).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        const cleanLead = (raw: string | null, max = 60): string | null => {
          if (!raw) return null;
          const t = raw.replace(/\s+/g, " ").trim();
          if (!t) return null;
          // Take just the first sentence-ish chunk, no trailing punctuation.
          const cut = t.split(/[.!?]\s|[\r\n]/)[0].trim();
          const text = cut.length <= max ? cut : `${cut.slice(0, max).trim()}…`;
          return text.charAt(0).toUpperCase() + text.slice(1);
        };
        const autoName =
          aiTitle ||
          cleanLead(intakeHeadline) ||
          cleanLead(firstMsgRaw) ||
          (projectNameRaw && projectNameRaw !== "Project"
            ? `${projectNameRaw} · ${friendlyDate}, ${friendlyTime}`
            : `Session · ${friendlyDate}, ${friendlyTime}`);
        return {
          id:          row.id as string,
          title:       autoName,
          agent:       row.agent_name as string | null,
          minutes:     row.duration_minutes != null ? Math.round(Number(row.duration_minutes)) : null,
          date:        created,
          status,
          projectId:   (row.project_id   as string | null) ?? null,
          projectName: projectNameRaw,
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
              employment={employment}
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

      {/* Online status pill — Order 1: the "Online" indicator the mock shows
          just below the wordmark. Pulses while we have an active session,
          calm dot otherwise. */}
      <div className="px-3 pb-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary-tint)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary-hover)]">
          <span
            aria-hidden
            className="relative inline-flex size-1.5"
          >
            <span
              className="absolute inset-0 inline-flex animate-ping rounded-full bg-[var(--primary)] opacity-60"
            />
            <span className="relative inline-flex size-1.5 rounded-full bg-[var(--primary)]" />
          </span>
          Online
        </span>
      </div>

      {/* Primary CTA — loud green "New session" + secondary "New chat". The
          plus icon stays, but the button itself is the most prominent
          control in the sidebar. Order 1 of the Commander brief. */}
      <div className="flex flex-col gap-2 px-2 py-1">
        <div className="flex gap-1.5">
          <Button
            variant="primary"
            size="md"
            onClick={onNewSession}
            className="flex-1 justify-center"
            iconLeft={<Plus size={15} />}
          >
            New session
          </Button>
          <IconButton
            aria-label="More session options"
            title="More options"
            variant="secondary"
            size="md"
            onClick={onNewSession}
          >
            <ChevronDown size={14} />
          </IconButton>
        </div>

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
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
            Projects
          </span>
          <button
            onClick={onNewSession}
            title="Start a new project"
            aria-label="Start a new project"
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
            style={{ color: "var(--primary-hover)" }}
          >
            <Plus size={11} />
            New project
          </button>
        </div>

        {projectGroups.length > 0
          ? projectGroups.map((group) => (
              <ProjectAccordion
                key={group.key}
                group={group}
                viewingPastId={viewingPastId}
                currentSessionId={session?.id ?? null}
                selectedProjectId={selectedProjectId}
                onViewPast={onViewPast}
                onStartInProject={onStartInProject}
                onRenameProject={onRenameProject}
                onSelectProject={onSelectProject}
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
              <WalletBalance session={session} entitlement={entitlement} employment={employment} />
            </div>
          </div>
          <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
        </button>
        {userMenuOpen && (
          <UserMenu
            email={email}
            session={session}
            entitlement={entitlement}
            employment={employment}
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
  session, entitlement, employment,
}: {
  session: GuestCall | null;
  entitlement: EntitlementShape;
  employment?: EmployeeInfo | null;
}) {
  // Employees draw from the dept allocation — surface the dept counter
  // here instead of the personal free/paid entitlement. Out → "Out of
  // credits" so the closed profile chip doesn't claim "Free used · upgrade
  // to continue" (the upgrade path doesn't apply to enterprise accounts).
  if (employment?.isEmployee === true) {
    const fmt = (n: number) => Math.round(n).toLocaleString();
    return employment.remainingMinutes > 0
      ? <>{`${fmt(employment.remainingMinutes)} min available`}</>
      : <>Out of credits</>;
  }

  const paidAt       = session?.paid_extension_at ?? null;
  const freeConsumed = !!entitlement.free_consumed_at;
  // Billing ticks from assigned_at (when the engineer accepted and chat began),
  // not from Zoom — so starting a Zoom call never resets the burn.
  const assignedAt   = session?.assigned_at ?? null;
  const isEnded      = session?.status === "ended" || session?.status === "cancelled" || session?.status === "abandoned";

  // Tick the visible balance whenever paid minutes are being burned:
  // either paid_extension_at is stamped (first-timer who upgraded), or the
  // customer is a returning paid user (free already consumed) and the
  // engineer has accepted.
  const shouldTick = !isEnded && !!assignedAt && (!!paidAt || freeConsumed);

  // Store the clock in state so the body stays pure for the lint rule.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!shouldTick) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [shouldTick]);

  let live = entitlement;
  if (shouldTick && assignedAt) {
    // Anchor: paid_extension_at if first-timer upgraded mid-session,
    // otherwise assigned_at for a returning paid user.
    const anchorMs = paidAt
      ? new Date(paidAt).getTime()
      : new Date(assignedAt).getTime();
    const paidElapsedMin = Math.max(0, (now - anchorMs) / 60_000);
    if (paidElapsedMin > 0) {
      live = {
        ...entitlement,
        paid_minutes_remaining: Math.max(0, entitlement.paid_minutes_remaining - paidElapsedMin),
      };
    }
  }
  return <>{formatEntitlement(live)}</>;
});

function planLabel(
  e: { free_consumed_at: string | null; paid_minutes_remaining: number },
  employment: EmployeeInfo | null,
): string {
  // Employees draw from their dept allocation — show "Enterprise plan" when
  // they still have minutes, "Out of credits" once the dept pool runs dry.
  // The personal entitlement (free/paid) is irrelevant for these accounts.
  if (employment?.isEmployee === true) {
    return employment.remainingMinutes > 0 ? "Enterprise plan" : "Out of credits";
  }
  if (e.paid_minutes_remaining > 0) return "Paid plan";
  return "Free plan";
}

// Employee info strip inside the user menu. Renders nothing for ordinary
// customers (the fetch returns isEmployee:false); for employees it shows
// the enterprise + department names and the per-employee allocation. Per
// spec we deliberately don't reveal whether the enterprise is organic or
// inorganic. Type is hoisted to the top of the file (search for the other
// `type EmployeeInfo` to see the canonical declaration).
const EmployeeInfoBlock = memo(function EmployeeInfoBlock({ info }: { info: EmployeeInfo | null }) {
  if (!info || info.isEmployee !== true) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined).format(Math.round(n));

  return (
    <div
      className="mt-1 rounded-lg px-2 py-2"
      style={{ backgroundColor: BRAND_GREEN_SOFT }}
    >
      <div className="flex items-center gap-2">
        <Building2 size={14} style={{ color: BRAND_GREEN }} />
        <div className="min-w-0 flex-1 leading-tight">
          <div
            className="truncate text-[12px] font-medium"
            style={{ color: "var(--text)" }}
          >
            {info.enterpriseName || "Enterprise"}
          </div>
          {info.departmentName && (
            <div
              className="truncate text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              {info.departmentName}
            </div>
          )}
        </div>
      </div>
      <div
        className="mt-2 grid grid-cols-3 gap-2 text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        <div className="flex flex-col">
          <span>Allocated</span>
          <span
            className="text-[12px] font-medium tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {fmt(info.allocatedMinutes)}
          </span>
        </div>
        <div className="flex flex-col">
          <span>Used</span>
          <span
            className="text-[12px] font-medium tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {fmt(info.usedMinutes)}
          </span>
        </div>
        <div className="flex flex-col">
          <span>Remaining</span>
          <span
            className="text-[12px] font-medium tabular-nums"
            style={{ color: BRAND_GREEN }}
          >
            {fmt(info.remainingMinutes)}
          </span>
        </div>
      </div>
    </div>
  );
});

// ── User menu dropdown (Claude-style) ─────────────────────────────────────
const UserMenu = memo(function UserMenu({
  email, session, entitlement, employment, onRecharge, onClose, collapsed = false,
}: {
  email: string;
  session: GuestCall | null;
  entitlement: EntitlementShape;
  employment: EmployeeInfo | null;
  onRecharge: () => void;
  onClose: () => void;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const isEmployee = employment?.isEmployee === true;

  const handleLogout = async () => {
    const sb = createClient();
    await sb.auth.signOut();
    router.push("/login");
  };

  const menuItems = [
    {
      icon: <Settings size={15} />,
      label: "Profile & settings",
      onClick: () => { onClose(); router.push("/account"); },
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
                  {planLabel(entitlement, employment)}
                </div>
              </div>
            </div>
            <Check size={14} style={{ color: BRAND_GREEN }} />
          </div>

          {/* Wallet + Recharge — only for ordinary customers. Employees
              draw from their dept allocation (rendered below); showing
              both widgets would be confusing and the Recharge button
              wouldn't make sense for an employee account. */}
          {!isEmployee && (
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
          )}

          {/* Employee info block — only visible when the signed-in user is
              an employee (profile.client_type='employee'). Shows the
              enterprise + department name and the per-employee minute
              allocation; never reveals organic vs inorganic. */}
          <EmployeeInfoBlock info={employment} />
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
    case "assigned":     return "Live";
    case "joining":      return "Joining call";
    case "live":         return "On call";
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
  group, viewingPastId, currentSessionId, selectedProjectId,
  onViewPast, onStartInProject, onRenameProject, onSelectProject,
}: {
  group: ProjectGroup;
  viewingPastId: string | null;
  /** Id of the currently-live session, if any. Clicking that row jumps
   *  back to the live view (onViewPast(null)) rather than opening it as
   *  a past-session review. */
  currentSessionId: string | null;
  /** Project currently selected as context for the no-session landing.
   *  When this row matches, render with a subtle highlight. */
  selectedProjectId: string | null;
  onViewPast: (id: string | null) => void;
  /** Called when the user clicks "+ Start session in this project". null
   *  is passed for the General bucket (no project id). */
  onStartInProject: (projectId: string | null) => void;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  /** Click on the project header → toggle this project as the landing
   *  CTA context. Not invoked for the General bucket. */
  onSelectProject: (projectId: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const [renameBusy, setRenameBusy] = useState(false);
  // The General bucket doesn't have a real project id and can't be
  // "started in" — sessions go there only as a fallback.
  const isGeneral = group.key === "general";
  const isSelected = !isGeneral && selectedProjectId === group.key;

  const commitRename = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === group.name) {
      setRenaming(false);
      setDraftName(group.name);
      return;
    }
    setRenameBusy(true);
    try {
      await onRenameProject(group.key, trimmed);
    } finally {
      setRenameBusy(false);
      setRenaming(false);
    }
  };

  return (
    <div className="mb-1 group/proj">
      {/* Project header */}
      <div className="relative flex items-center">
        <button
          onClick={() => {
            setOpen((v) => !v);
            // General has no real project id — clicking it just toggles
            // open/close, no selection state.
            if (!isGeneral) onSelectProject(group.key);
          }}
          className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={isSelected ? { backgroundColor: BRAND_GREEN_SOFT } : undefined}
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
          <Folder size={11} style={{ color: isSelected ? BRAND_GREEN : "var(--text-muted)", flexShrink: 0 }} />
          {renaming && !isGeneral ? (
            <input
              autoFocus
              value={draftName}
              disabled={renameBusy}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter")  (e.currentTarget as HTMLInputElement).blur();
                if (e.key === "Escape") { setRenaming(false); setDraftName(group.name); }
              }}
              className="min-w-0 flex-1 rounded-sm border px-1 py-0 text-[11px] font-semibold uppercase tracking-[0.08em] outline-none"
              style={{
                borderColor: BRAND_GREEN,
                backgroundColor: "var(--background)",
                color: "var(--text)",
              }}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: isSelected ? BRAND_GREEN : "var(--text-muted)" }}
            >
              {group.name}
            </span>
          )}
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
        {!isGeneral && !renaming && (
          <>
            {/* FIX 3 — LOUD FILLED GREEN CIRCLE call button. Larger than
                the mock's thin glyph (~32px hit target), primary-feeling,
                always visible. Confident "start a session in this
                project" action. */}
            <button
              onClick={(e) => { e.stopPropagation(); onStartInProject(group.key); }}
              title={`Start a session in ${group.name}`}
              aria-label={`Start a session in ${group.name}`}
              className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              <Phone size={11} strokeWidth={2.4} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Lightweight overflow — for now this opens the rename
                // affordance. Future: a popover menu with rename / new
                // session / archive.
                setDraftName(group.name);
                setRenaming(true);
              }}
              title={`More actions for ${group.name}`}
              aria-label={`More actions for ${group.name}`}
              className="ml-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-raised)]"
              style={{ color: "var(--text-muted)" }}
            >
              <MoreHorizontal size={14} />
            </button>
          </>
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
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  // FIX 3 — selected session card gets a real green border
                  // + light-green tint (was just a faint fill before),
                  // matching the room-w.png "CORS error issues" card.
                  selected
                    ? "border-[var(--primary)] bg-[var(--primary-tint)]"
                    : isCurrent
                      ? "border-[var(--primary)] bg-[var(--primary-tint)]/60"
                      : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-raised)]",
                )}
              >
                <span
                  className={cn(
                    "relative mt-1.5 flex h-2 w-2 shrink-0 rounded-full",
                    isActive
                      ? "bg-[var(--primary)]"
                      : s.status === "ended"
                        ? "bg-[var(--text-faint)]"
                        : s.status === "cancelled"
                          ? "bg-[var(--text-faint)]"
                          : "bg-[var(--text-faint)]",
                  )}
                  aria-hidden
                >
                  {isActive && (
                    <span
                      className="absolute inset-0 inline-flex animate-ping rounded-full opacity-70"
                      style={{ backgroundColor: BRAND_GREEN }}
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div
                      className={cn(
                        "truncate text-[13px]",
                        selected || isCurrent ? "font-medium" : "",
                      )}
                      style={{
                        color:
                          selected || isCurrent
                            ? "var(--text)"
                            : isActive
                              ? "var(--text)"
                              : "var(--text)",
                      }}
                    >
                      {s.title}
                    </div>
                  </div>
                  <div
                    className="mt-0.5 flex items-center gap-1 text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {/* FIX 2 — status flows as a small meta tag, never as
                        the session's name. */}
                    {!isActive && (
                      <>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                            s.status === "ended"
                              ? "bg-[var(--surface-raised)] text-[var(--text-muted)]"
                              : s.status === "cancelled"
                                ? "bg-[var(--warn-soft)] text-[var(--warn)]"
                                : "bg-[var(--risk-soft)] text-[var(--risk)]",
                          )}
                        >
                          {s.status === "ended"
                            ? "Ended"
                            : s.status === "cancelled"
                              ? "Cancelled"
                              : "No engineer"}
                        </span>
                      </>
                    )}
                    {isActive ? (
                      <span>{humanState(s.status)}</span>
                    ) : (
                      <>
                        {s.agent && <span>{s.agent}</span>}
                        {s.agent && <span>·</span>}
                        <span>{fmtRelDate(new Date(s.date))}</span>
                        {s.minutes != null && s.minutes > 0 && (
                          <>
                            <span>·</span>
                            <span>{s.minutes}m</span>
                          </>
                        )}
                      </>
                    )}
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
  state, fullWidth = false, employment, onNeedsCredits, onNeedProject,
}: {
  state: ReturnType<typeof useCustomerSession>;
  fullWidth?: boolean;
  /** Employment snapshot — when the viewer is an employee
   *  (client_type='employee'), the credits guard below is bypassed because
   *  their minutes come from the dept pool, not the personal entitlement. */
  employment?: EmployeeInfo | null;
  onNeedsCredits?: () => void;
  /** Retained for back-compat with the project-picker path; the current
   *  flow auto-starts sessions in a default "project" project so this is
   *  almost never invoked. */
  onNeedProject?: (draft: string) => void;
}) {
  void onNeedProject;
  const router = useRouter();
  const session = state.session;
  const isReadOnly = session?.status === "ended";
  const isSupervisor = useIsSupervisor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isEmployee = employment?.isEmployee === true;

  // Auto-scroll to the latest message when the message list changes (new
  // chat lines, system entries, meeting-card transitions). Smooth scroll
  // for the natural "follow the conversation" feel, same pattern the
  // engineer side uses in EngineerSessionClient → ChatPane.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.messages.length]);

  const handleSend = async ({ text, files }: { text: string; files: File[] }) => {
    const wouldCreateNew = !session || ["cancelled", "abandoned", "ended"].includes(session.status);
    // Employees route around the credits guard: their minutes come from
    // the dept allocation, not the personal entitlement. The "out of
    // credits" surface for them is the dept-managed plan chip, not the
    // paywall.
    if (!isEmployee) {
      const hasFreeLeft = !state.entitlement.free_consumed_at;
      const hasPaidLeft = state.entitlement.paid_minutes_remaining > 0;
      if (wouldCreateNew && !hasFreeLeft && !hasPaidLeft && onNeedsCredits) {
        onNeedsCredits();
        return;
      }
    }
    // First message in a brand-new project flows through the intake
    // wizard — that's where we collect the questionnaire that feeds
    // engineer matching. The draft text is stashed so we can re-send it
    // once the engineer accepts and we're back on /room.
    if (wouldCreateNew) {
      try {
        if (text.trim()) sessionStorage.setItem("relay:intake:draft", text);
      } catch { /* ignore quota / privacy mode */ }
      router.push("/intake");
      return;
    }
    await state.sendBundle({ text, files });
  };

  const maxWidth = fullWidth ? "max-w-3xl" : "max-w-none";

  // Pair "Zoom meeting started" / "Zoom meeting ended" system messages by
  // chronological order so each call renders as one inline mini-card at
  // the position it was started in the chat. Endeds that have a matching
  // started are suppressed below; orphan endeds (legacy chats without a
  // started counterpart) fall through to the normal system-chip render.
  // The same pairing also attaches both the AI Companion summary AND the
  // cloud-recording line that follow each ended message so the meeting
  // card can reveal them on demand instead of crowding the timeline.
  const meetingEnded = new Map<string, GuestMessage>(); // started.id -> ended msg
  const meetingSummary = new Map<string, GuestMessage>(); // started.id -> summary msg
  const meetingRecording = new Map<string, GuestMessage>(); // started.id -> recording msg
  const suppressedEndedIds = new Set<string>();
  const suppressedSummaryIds = new Set<string>();
  const suppressedRecordingIds = new Set<string>();
  {
    const queue: GuestMessage[] = [];
    let lastEndedStartId: string | null = null;
    for (const m of state.messages) {
      if (m.sender_kind !== "system") continue;
      if ((m.body ?? "").includes("Zoom meeting started")) {
        queue.push(m);
        lastEndedStartId = null;
      } else if ((m.body ?? "").includes("Zoom meeting ended")) {
        const start = queue.shift();
        if (start) {
          meetingEnded.set(start.id, m);
          suppressedEndedIds.add(m.id);
          lastEndedStartId = start.id;
        }
      } else if (m.body && isAiSummaryMessageBody(m.body) && lastEndedStartId) {
        meetingSummary.set(lastEndedStartId, m);
        suppressedSummaryIds.add(m.id);
      } else if (m.body && m.body.includes("Recording available") && lastEndedStartId) {
        meetingRecording.set(lastEndedStartId, m);
        suppressedRecordingIds.add(m.id);
      }
    }
  }

  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
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
              {state.messages.flatMap((m) => {
                if (isSupervisorOnlyMessage(m) && !isSupervisor) return [];
                if (m.sender_kind === "system" && (m.body ?? "").includes("Zoom meeting started")) {
                  const ended = meetingEnded.get(m.id) ?? null;
                  const summary = meetingSummary.get(m.id) ?? null;
                  const recording = meetingRecording.get(m.id) ?? null;
                  const durationSec = ended
                    ? Math.floor((new Date(ended.created_at).getTime() - new Date(m.created_at).getTime()) / 1000)
                    : undefined;
                  return [
                    <MeetingChatEntry
                      key={m.id}
                      active={!ended}
                      durationSec={durationSec}
                      joinUrl={!ended ? session?.zoom_join_url ?? null : null}
                      onJoin={!ended ? () => void state.markJoined() : undefined}
                      selfJoined={!!session?.customer_joined_at}
                      summaryBody={summary?.body ?? null}
                      recordingBody={isSupervisor ? recording?.body ?? null : null}
                    />,
                  ];
                }
                if (m.sender_kind === "system" && suppressedEndedIds.has(m.id)) {
                  return [];
                }
                if (m.sender_kind === "system" && suppressedSummaryIds.has(m.id)) {
                  return [];
                }
                if (m.sender_kind === "system" && suppressedRecordingIds.has(m.id)) {
                  return [];
                }
                if (m.sender_kind === "system" && m.body && isAiSummaryMessageBody(m.body)) {
                  return [<MeetingSummaryEntry key={m.id} body={m.body} />];
                }
                return [<Message key={m.id} message={m} />];
              })}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="px-4 pb-6 pt-2">
        <div className={`mx-auto w-full ${maxWidth}`}>
          <ChatComposer
            disabled={isReadOnly}
            placeholder={isReadOnly ? "This session has ended" : "Describe what you're working on…"}
            onSend={handleSend}
          />
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
  const hasAttachments = !!message.attachments && message.attachments.length > 0;
  const hasText = !!message.body && message.body.length > 0;
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="mb-0.5 px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {message.sender_name ?? (mine ? "You" : "Engineer")}
      </div>
      <div
        className="flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap"
        style={
          mine
            ? { backgroundColor: BRAND_GREEN, color: "#fff", borderBottomRightRadius: 4 }
            : { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text)", borderBottomLeftRadius: 4 }
        }
      >
        {hasAttachments && <MessageAttachments attachments={message.attachments} />}
        {hasText && <div>{message.body}</div>}
      </div>
    </div>
  );
});


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
        <SummaryView session={session} messages={messages} />
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

function SummaryView({ session, messages }: { session: GuestCall; messages: GuestMessage[] }) {
  const title = session.ai_summary_title;
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];
  const dur = session.duration_minutes != null ? Math.round(Number(session.duration_minutes)) : 0;
  // Per-call Zoom AI Companion summaries arrive as system chat messages
  // (see zoom-webhook.handleSummaryCompleted). Surface them in the sidebar
  // alongside the aggregated chat summary so both signals live together.
  // Dedupe by body — Zoom sometimes redelivers the summary webhook (retry
  // or the underscore/dot event-name pair), producing identical rows.
  const seenCompanionBodies = new Set<string>();
  const zoomCompanionMessages = messages.filter((m) => {
    if (m.sender_kind !== "system" || !m.body || !isAiSummaryMessageBody(m.body)) return false;
    const key = m.body.trim();
    if (seenCompanionBodies.has(key)) return false;
    seenCompanionBodies.add(key);
    return true;
  });
  // Drive UI off the explicit summary_state machine — see migration
  // 20260518200000_summary_state.sql. Avoids the prior infinite-spinner
  // bug when the Zoom AI Companion summary never lands.
  const state = session.summary_state ?? "idle";
  const generating =
    state === "generating_session_summary" ||
    state === "generating_zoom_summary" ||
    state === "waiting_for_transcript";
  const generatingLabel =
    state === "waiting_for_transcript" ? "Waiting for Zoom summary…" :
    state === "generating_zoom_summary" ? "Reading Zoom transcript…" :
    "Generating summary…";

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
            {generatingLabel}
          </p>
        </div>
      ) : state === "no_conversation" ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            No conversation happened during this session.
          </p>
          <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
            Recording wasn&apos;t started and no chat messages were exchanged.
          </p>
        </div>
      ) : state === "transcript_unavailable" && !overview ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle size={18} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Zoom summary unavailable</p>
          <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
            The Zoom AI Companion summary didn&apos;t arrive in time.
          </p>
        </div>
      ) : state === "summary_failed" && !overview ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle size={18} style={{ color: "var(--accent-red)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Couldn&apos;t generate the summary</p>
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
          {zoomCompanionMessages.length > 0 && (
            <div className="pt-2">
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Zoom call summaries
              </h3>
              <div className="space-y-3">
                {zoomCompanionMessages.map((m) => (
                  <MeetingSummaryEntry key={m.id} body={m.body ?? ""} />
                ))}
              </div>
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

// ── Project name editor (inline at the top of ConnectingModal) ─────────────
function ProjectNameEditor({
  session, projects, onProjectsChanged,
}: {
  session: GuestCall;
  projects: Project[];
  onProjectsChanged: () => void | Promise<void>;
}) {
  const fallbackName = "project";
  const initialName  = session.project_name ?? fallbackName;

  const [draft,    setDraft]    = useState<string>(initialName);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [open,     setOpen]     = useState(false);
  const [hover,    setHover]    = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keep local state in sync if the session row updates (e.g. realtime patch).
  useEffect(() => {
    setDraft(session.project_name ?? fallbackName);
  }, [session.project_name, fallbackName]);

  // Close the suggestion popover when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Filtered project suggestions.
  const suggestions = (() => {
    const q = draft.trim().toLowerCase();
    const list = projects
      // Don't suggest the project the user is already in.
      .filter((p) => p.id !== session.project_id)
      .filter((p) => !q || p.name.toLowerCase().includes(q));
    return list.slice(0, 6);
  })();

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const saveRename = async (nextName: string) => {
    const trimmed = nextName.trim() || fallbackName;
    if (trimmed === (session.project_name ?? "")) return;
    setSaving(true);
    try {
      const sb = createClient();
      if (session.project_id) {
        await sb.from("projects").update({ name: trimmed }).eq("id", session.project_id);
      }
      await sb.from("guest_calls").update({ project_name: trimmed }).eq("id", session.id);
      await onProjectsChanged();
      flashSaved();
    } finally {
      setSaving(false);
    }
  };

  const switchToProject = async (projectId: string) => {
    setSaving(true);
    try {
      const sb = createClient();
      const proj = projects.find((p) => p.id === projectId);
      await sb
        .from("guest_calls")
        .update({ project_id: projectId, project_name: proj?.name ?? null })
        .eq("id", session.id);
      setDraft(proj?.name ?? "");
      flashSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-[0.15em]"
          style={{ color: "var(--text-muted)" }}>
          Project name
        </label>
        {saving ? (
          <Loader2 size={11} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        ) : saved ? (
          <span className="text-[10px]" style={{ color: BRAND_GREEN }}>Saved</span>
        ) : null}
      </div>
      <div ref={wrapRef} className="relative">
        <input
          type="text"
          value={draft}
          autoFocus
          placeholder={fallbackName}
          onChange={(e) => {
            setDraft(e.target.value);
            if (projects.length > 0) setOpen(true);
            setHover(-1);
          }}
          onFocus={() => {
            if (projects.length > 0) setOpen(true);
          }}
          onBlur={() => {
            // Delay so a click on a suggestion still registers.
            setTimeout(() => {
              if (!wrapRef.current?.contains(document.activeElement)) {
                setOpen(false);
                const match = projects.find((p) => p.name === draft.trim());
                if (match && match.id !== session.project_id) {
                  void switchToProject(match.id);
                } else {
                  void saveRename(draft);
                }
              }
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && suggestions.length > 0) {
              e.preventDefault();
              setOpen(true);
              setHover((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp" && suggestions.length > 0) {
              e.preventDefault();
              setHover((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              if (open && hover >= 0 && suggestions[hover]) {
                e.preventDefault();
                const pick = suggestions[hover];
                setDraft(pick.name);
                setOpen(false);
                void switchToProject(pick.id);
              } else {
                (e.currentTarget as HTMLInputElement).blur();
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--brand-green,#3f5c2e)]"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--background)",
            color: "var(--text)",
          }}
        />
        {open && suggestions.length > 0 && (
          <ul
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-56 overflow-y-auto rounded-md border py-1 shadow-lg"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
            }}
          >
            {suggestions.map((p, i) => (
              <li
                key={p.id}
                onMouseEnter={() => setHover(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraft(p.name);
                  setOpen(false);
                  void switchToProject(p.id);
                }}
                className="cursor-pointer px-2.5 py-1.5 text-sm"
                style={{
                  backgroundColor: i === hover ? BRAND_GREEN_SOFT : "transparent",
                  color: "var(--text)",
                }}
              >
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {projects.length > 0
          ? "Type a new name or pick from your previous projects below. You can rename later."
          : "You can rename this later."}
      </p>
    </div>
  );
}

// ── Connecting Modal ───────────────────────────────────────────────────────
function ConnectingModal({
  session, onRecall, onCancel, projects, onProjectsChanged,
}: {
  session: GuestCall;
  onRecall: () => Promise<void>;
  /** Explicit cancel — actually stops ringing. Distinct from × (minimize). */
  onCancel: () => Promise<void>;
  projects: Project[];
  onProjectsChanged: () => void | Promise<void>;
}) {
  // FIX 1 — the modal is CLOSABLE via × / Esc / click-outside, but those
  // MINIMIZE the card into a top-center pill rather than cancelling the
  // search. The rest of the app stays usable while the engineer search
  // continues in the background. Only the explicit "Cancel search" button
  // inside the expanded card actually stops ringing.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMinimized(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minimized]);

  // Anchor the 90-second countdown to the most recent of created_at /
  // last_recall_at. That way clicking "Call again" naturally restarts the
  // window — no extra timer-reset state needed on the client.
  const QUEUE_TIMEOUT_S = 90;
  const queuedAt     = new Date(session.created_at).getTime();
  const lastRecallAt = session.last_recall_at ? new Date(session.last_recall_at).getTime() : 0;
  const anchor       = Math.max(queuedAt, lastRecallAt);

  const [now, setNow] = useState<number>(() => Date.now());
  const [recalling, setRecalling] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed   = Math.max(0, Math.floor((now - anchor) / 1000));
  const remaining = Math.max(0, QUEUE_TIMEOUT_S - elapsed);
  const expired   = remaining === 0;
  const mins      = Math.floor(remaining / 60);
  const secs      = remaining % 60;

  // Ring geometry — change RADIUS only; SIZE and CENTER follow so the
  // outer canvas always fits the full stroke with breathing room.
  const RADIUS = 68;
  const STROKE = 6;
  const PADDING = 8;
  const SIZE   = 2 * (RADIUS + STROKE / 2 + PADDING); // = 160 for r=68
  const CENTER = SIZE / 2;
  const CIRC   = 2 * Math.PI * RADIUS;
  // Ring drains as time passes; sits at fully-empty when expired.
  const dashOffset = CIRC * (1 - remaining / QUEUE_TIMEOUT_S);

  const ringColor = session.urgency === "critical" ? CRIT_RED
    : session.urgency === "urgent" ? URGENT_AMBER
    : BRAND_GREEN;
  const ringSoft = session.urgency === "critical" ? CRIT_RED_SOFT
    : session.urgency === "urgent" ? URGENT_AMBER_SOFT
    : BRAND_GREEN_SOFT;

  const handleCallAgain = async () => {
    setRecalling(true);
    try { await onRecall(); } finally { setRecalling(false); }
  };

  if (minimized) {
    // Top-center floating "still ringing" pill — iOS Dynamic-Island style.
    // Pulsing green dot + headline + live countdown, tap to re-expand.
    return (
      <div
        className="fixed inset-x-0 top-4 z-40 flex justify-center px-4"
        aria-live="polite"
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 shadow-lg backdrop-blur transition-transform hover:scale-[1.02]"
          aria-label="Re-open the calling screen"
        >
          <span aria-hidden className="relative inline-flex size-2">
            <span
              className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60"
              style={{ background: ringColor }}
            />
            <span
              className="relative inline-flex size-2 rounded-full"
              style={{ background: ringColor }}
            />
          </span>
          <span className="text-sm font-medium text-[var(--text)]">
            Calling engineer
          </span>
          <span
            className="font-mono text-xs tabular-nums"
            style={{ color: expired ? "var(--text-muted)" : ringColor }}
          >
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </span>
          <span
            role="button"
            aria-label="Cancel search"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              void onCancel();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                void onCancel();
              }
            }}
            className="ml-1 inline-flex size-5 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--risk-soft)] hover:text-[var(--risk)]"
            title="Cancel search"
          >
            <PhoneOff size={11} />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        // Click-outside the card → minimize, do NOT cancel.
        if (e.target === e.currentTarget) setMinimized(true);
      }}
    >
      <div className="relative w-full max-w-sm rounded-2xl border p-8 shadow-xl"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>

        {/* Close (minimize) — top-right. Esc + click-outside do the same. */}
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimize — keep waiting"
          title="Minimize — keep waiting (Esc)"
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
        >
          <X size={15} />
        </button>


        {/* Project name editor — visible while the customer waits.
            Returning customers get a dropdown of their existing projects
            plus a "New project…" option. */}
        <ProjectNameEditor
          session={session}
          projects={projects}
          onProjectsChanged={onProjectsChanged}
        />

        {session.urgency !== "normal" && (
          <div className="mb-4 flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ backgroundColor: ringSoft, color: ringColor }}>
            <AlertTriangle size={11} />
            {session.urgency === "critical" ? "Critical priority" : "Urgent priority"}
          </div>
        )}

        {/* Timer ring */}
        <div className="mb-5 flex justify-center">
          <div className="relative" style={{ height: SIZE, width: SIZE }}>
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="-rotate-90"
            >
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" strokeWidth={STROKE}
                style={{ stroke: ringSoft }} />
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" strokeWidth={STROKE} strokeLinecap="round"
                style={{
                  stroke: expired ? "var(--text-muted)" : ringColor,
                  strokeDasharray: CIRC,
                  strokeDashoffset: dashOffset,
                  transition: "stroke-dashoffset 1s linear",
                }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-3xl font-medium tabular-nums"
                style={{
                  fontFamily: "var(--font-inter)",
                  color: expired ? "var(--text-muted)" : ringColor,
                }}>
                {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </div>
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.15em]"
                style={{ color: "var(--text-muted)" }}>
                {expired ? "No answer" : "Avg wait"}
              </div>
            </div>
          </div>
        </div>

        {/* Heading + subtitle — flip when the 3-min window has elapsed */}
        <div className="mb-6 text-center">
          <h2 className="mb-2 text-xl font-medium"
            style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}>
            {expired ? "Still searching…" : "Calling engineer…"}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {expired
              ? "No one's picked up just yet. Try calling again — we'll page the next available engineer."
              : "We're matching you with the right engineer."}
          </p>
        </div>

        {/* "Call again" appears ONLY once the 3-min countdown has elapsed.
            During the wait we deliberately show no CTA so customers don't
            spam recalls. */}
        {expired && (
          <button
            onClick={() => void handleCallAgain()}
            disabled={recalling}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: ringColor, color: "#fff" }}
          >
            {recalling ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
            {recalling ? "Calling…" : "Call again"}
          </button>
        )}

        {/* Explicit cancel — destructive-ghost, the ONLY control that stops
            ringing. × / Esc / click-outside minimize; this one cancels. */}
        <button
          type="button"
          onClick={() => void onCancel()}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-transparent px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--risk-soft)] hover:bg-[var(--risk-soft)] hover:text-[var(--risk)]"
        >
          <PhoneOff size={12} />
          Cancel search
        </button>

        <p className="mt-3 text-center text-[10px] leading-relaxed text-[var(--text-faint)]">
          Press <kbd className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 font-mono">Esc</kbd>{" "}
          to minimize and keep waiting — the search continues in the background.
        </p>
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

// ── Session summary tray (3-column shell, right rail) ──────────────────────
// Always-visible right rail on /room for ACTIVE sessions. Mirrors room-w.png:
//   - Header  : "Session summary" + status + collapse chevron
//   - Topic   : session.summary_title || fallback
//   - Steps   : intake-derived "Next steps" with green-check rows
//                (reads client_intakes.intake_summary on the same guest_call)
//   - AI      : intake_summary body
//   - Details : engineer, started, duration, status pill
// Read-only — engineer's tray on /staff/session does the same, this one is
// the customer-side mirror. Collapse state persists per-tab.

const ROOM_TRAY_KEY = "relay-room-summary-tray-open";

type RoomTrayIntakeRow = {
  intake_summary: string | null;
  developing: string | null;
  technologies: string[] | null;
  ai_tools_used: string | null;
};

function SessionSummaryTray({ session }: { session: GuestCall }) {
  const supabaseRef = useRef(createClient());
  const [intake, setIntake] = useState<RoomTrayIntakeRow | null>(null);
  const [open, setOpen] = useState<boolean>(() => {
    // Collapsed by default; persists per-tab once the user toggles it.
    if (typeof window === "undefined") return false;
    const v = window.localStorage.getItem(ROOM_TRAY_KEY);
    return v === null ? false : v === "1";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ROOM_TRAY_KEY, open ? "1" : "0");
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const sb = supabaseRef.current;
    const fetchOne = async () => {
      const { data } = await sb
        .from("client_intakes")
        .select("intake_summary, developing, technologies, ai_tools_used")
        .eq("guest_call_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setIntake((data as RoomTrayIntakeRow | null) ?? null);
    };
    void fetchOne();
    const channel = sb
      .channel(`room-tray:${session.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "client_intakes" },
        () => { void fetchOne(); },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [session.id]);

  // Derive a Next-steps list from the intake summary body if the AI returned
  // one (the edge fn writes a "Next steps:\n• …" block).
  const nextSteps: string[] = (() => {
    if (!intake?.intake_summary) return [];
    const lines = intake.intake_summary.split("\n");
    const startIdx = lines.findIndex((l) => /^next steps:?$/i.test(l.trim()));
    if (startIdx < 0) return [];
    const out: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) break;
      out.push(t.replace(/^[•\-*]\s*/, ""));
    }
    return out;
  })();

  const status = session.status;
  const statusLabel =
    status === "live"
      ? "On call"
      : status === "queued"
        ? "Ringing"
        : status === "joining"
          ? "Joining"
          : status === "assigned"
            ? "Engineer assigned"
            : status === "grace"
              ? "Wrapping up"
              : status;

  return (
    <aside
      aria-label="Session summary"
      className={cn(
        "hidden lg:flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200 ease-out",
        open ? "w-80" : "w-10",
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse summary" : "Expand summary"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
        >
          {open ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        {open && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            <FileText size={12} /> Session summary
          </span>
        )}
        {open && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[var(--primary-tint)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary-hover)]"
            aria-live="polite"
          >
            <span aria-hidden className="inline-flex size-1.5 rounded-full bg-[var(--primary)]" />
            {statusLabel}
          </span>
        )}
      </div>

      {open && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
          <div>
            <h3 className="font-serif text-base leading-snug text-[var(--text)]">
              {session.ai_summary_title || "Live session"}
            </h3>
            {session.agent_name && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                With {session.agent_name}
              </p>
            )}
          </div>

          {nextSteps.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Next steps
              </div>
              <ul className="space-y-1.5">
                {nextSteps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-[var(--text)]">
                    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[var(--primary-hover)]">
                      <Check size={11} />
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {intake?.intake_summary && (
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                AI summary
              </div>
              <div className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text)]">
                {intake.intake_summary}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Session details
            </div>
            <dl className="space-y-1.5 text-[12px]">
              {session.agent_name && (
                <DetailRow label="Engineer" value={session.agent_name} />
              )}
              {intake?.developing && (
                <DetailRow label="Building" value={intake.developing} />
              )}
              {intake?.technologies?.length ? (
                <DetailRow label="Stack" value={intake.technologies.join(", ")} />
              ) : null}
              {intake?.ai_tools_used && (
                <DetailRow label="AI tools" value={intake.ai_tools_used} />
              )}
              {session.created_at && (
                <DetailRow
                  label="Started"
                  value={new Date(session.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                />
              )}
            </dl>
          </div>
        </div>
      )}
    </aside>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-20 shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="flex-1 text-[var(--text)]">{value}</dd>
    </div>
  );
}

// ── Async chat pane ────────────────────────────────────────────────────────
// Surface for the "New chat" entry point. No ringing — the customer drops
// straight into a conversation with a context-aware bot greeting. A
// prominent green call button at the top lets them escalate to a live
// session ("New session" path) any time.
//
// // TODO(openai): the bot greeting + follow-up prompts should call an
// OpenAI-backed server route seeded with the user's profile + the last
// project's summary. Today the IntakeAssistant uses local heuristics; the
// transport is the single seam to swap.
function AsyncChatPane({
  onEscalateToCall,
  onCloseAsyncMode,
}: {
  onEscalateToCall: () => void;
  onCloseAsyncMode: () => void;
}) {
  return (
    <section className="flex h-full flex-col bg-[var(--background)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-[var(--primary-hover)]">
            <Sparkles size={14} />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--text)]">
              relay chat
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              No ring — describe it, an engineer picks it up
            </div>
          </div>
        </div>
        <IconButton
          aria-label="Escalate to a live call"
          title="Start a live call — engineer joins in seconds"
          variant="primary"
          size="md"
          onClick={onEscalateToCall}
        >
          <Video size={16} />
        </IconButton>
        <IconButton
          aria-label="Close async chat"
          title="Close async chat"
          variant="ghost"
          size="md"
          onClick={onCloseAsyncMode}
        >
          <X size={15} />
        </IconButton>
      </div>

      <div className="flex flex-1 justify-center overflow-hidden p-4">
        <div className="flex w-full max-w-2xl flex-1 min-h-0">
          <IntakeAssistant
            greeting="Hi! Describe what you need help with — drop a screenshot or paste an error if you have one. An engineer will pick this up; you can also tap the green call button up top to ring someone now."
          />
        </div>
      </div>
    </section>
  );
}
