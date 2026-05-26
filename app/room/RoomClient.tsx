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
  Building2, FileText, Clock, Video, MoreHorizontal, UserPlus, Pin, SlidersHorizontal,
  Paperclip, Mic, Download, Music, AudioLines, ShieldCheck, Receipt, Home,
  Trash2, Rocket, Wrench,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { ThemeTriplet } from "@/app/_components/ThemeTriplet";
import { MeetingChatEntry } from "@/app/_components/MeetingChatEntry";
import { MeetingSummaryEntry, isAiSummaryMessageBody } from "@/app/_components/MeetingSummaryEntry";
import { PaywallModal } from "@/app/_components/PaywallModal";
import { ChatComposer, speechRecognitionErrorMessage, queryMicPermission } from "@/app/_components/ChatComposer";
import { AccountPane } from "@/app/_components/AccountPane";
import { LegalPane, type LegalKind } from "@/app/_components/LegalPane";
import { DeleteProjectModal } from "@/app/_components/DeleteProjectModal";
import { ScheduleEngineerModal } from "@/app/_components/ScheduleEngineerModal";
import { MessageAttachments } from "@/app/_components/MessageAttachments";
import { Button, EmptyState, IconButton, Modal, cn } from "@/app/_components/ui";
import { useCustomerSession } from "@/lib/relay/useCustomerSession";
import { useIsSupervisor, isSupervisorOnlyMessage } from "@/lib/relay/useIsSupervisor";
import { useSessionTimer } from "@/lib/relay/useSessionTimer";
import { computeSessionClock } from "@/lib/relay/sessionClock";
import { createClient } from "@/lib/supabase/browser";
import { patchProfile, readProfile, writeStack } from "@/lib/relay/profile";
import { readProjectMetadata, writeProjectMetadata, deleteProjectMetadata } from "@/lib/relay/projectMetadata";
import {
  readDraft as readSessionDraft,
  saveDraft as saveSessionDraft,
  deleteDraft as deleteSessionDraft,
  deleteDraftsForProject,
  listDraftsForProject,
  deriveDraftTitle,
  type SessionDraft,
} from "@/lib/relay/sessionDrafts";
import { IntakeAssistant } from "@/app/_components/intake/IntakeAssistant";
import { GlobalNewChatModal } from "@/app/_components/GlobalNewChatModal";
import { EditableSummary } from "@/app/_components/EditableSummary";
import { QuoteRequestModal } from "@/app/_components/QuoteRequestModal";
import { useRingtone } from "@/lib/relay/useRingtone";
import type { GuestCall, GuestMessage, GuestMessageAttachment, SessionStatus, Urgency } from "@/lib/supabase/types";
import { signedDownloadUrl, validateStagedFiles } from "@/lib/relay/chatAttachments";
import {
  addAttachment as stubAddAttachment,
  listAttachments as stubListAttachments,
  removeAttachment as stubRemoveAttachment,
  flushAttachmentsToSession as flushStubAttachments,
  type StubAttachmentMeta,
} from "@/lib/relay/stubDraftAttachments";

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

  // ── Auto-flush stub draft attachments ────────────────────────────
  // When the session transitions to a live-ish state and the customer
  // has files/voice notes staged in IndexedDB (via the ChatPanelStub
  // paperclip + record buttons), upload them now and bind them to a
  // single system message in the new thread. One-shot: a ref-flag
  // gates the call per session id so a status oscillation doesn't
  // re-flush. See lib/relay/stubDraftAttachments.ts for the queue.
  const flushedForSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const s = state.session;
    if (!s) return;
    const live = ["assigned", "joining", "live", "grace"].includes(s.status);
    if (!live) return;
    if (flushedForSessionRef.current === s.id) return;
    flushedForSessionRef.current = s.id;
    void (async () => {
      try {
        const sb = createClient();
        const n = await flushStubAttachments({ sb, sessionId: s.id });
        if (n > 0) {
          // Refresh the messages list so the engineer + customer both
          // see the new prep-attachments message immediately.
          await state.refresh();
        }
      } catch (err) {
        // Don't reset the ref so we don't loop on a failing flush —
        // the customer can re-attach + re-trigger by leaving + rejoining.
        console.warn("[stub-flush] failed:", err instanceof Error ? err.message : err);
      }
    })();
  }, [state.session?.id, state.session?.status, state]);

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

  // (The ended-session "Pick up where you left off" card — Continue this
  // session / Start a follow-up session — was removed per product request.
  // An ended session now shows a read-only transcript with no resume CTAs.)

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

  // In-pane Account / Profile / Wallet / Billing / Security view. When
  // non-null, MainPane renders <AccountPane> instead of the landing /
  // chat / past-session-review. Setting this to "wallet" is how the
  // Recharge entry works now — it slides the customer into the account
  // pane's Wallet tab where they can hit Recharge to open the Stripe
  // modal. Null returns to whatever view was prior (session, landing,
  // etc).
  const [accountTab, setAccountTab] = useState<null | "profile" | "wallet" | "billing" | "security" | "notifications">(null);

  // In-pane legal document viewer (Privacy / Terms). When non-null,
  // MainPane mounts <LegalPane> in place of everything else. Like
  // accountTab, this is a side-track view that clears as soon as the
  // customer navigates to a session/project/new-session.
  const [legalView, setLegalView] = useState<null | LegalKind>(null);

  // "Prepare a session" view — customer clicks the + next to a project
  // and drafts their problem (text, files, voice) BEFORE calling an
  // engineer. The draft stays on this device until they hit the
  // project's phone button to actually ring; the engineer then walks
  // in with the prepared context. Null = no prep view active.
  //
  // preparingDraftId: when non-null, the prep view is editing an
  // already-saved draft (sidebar row → click → re-open). When null
  // but preparingProjectId is set, it's a fresh unsaved prep.
  const [preparingProjectId, setPreparingProjectId] = useState<string | null>(null);
  const [preparingDraftId,   setPreparingDraftId]   = useState<string | null>(null);
  // 2-factor delete-project modal target. null = modal closed.
  // { id, name } when the modal is open for a specific project.
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{ id: string; name: string } | null>(null);
  // Bumped whenever a draft is saved / deleted so the sidebar
  // re-reads from localStorage and re-renders the draft rows.
  const [draftsTick, setDraftsTick] = useState(0);
  const bumpDrafts = useCallback(() => setDraftsTick((t) => t + 1), []);

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

  // Once the engineer picks up — the session enters an active/timer-running
  // state — the async "relay chat" panel has done its job. Auto-close it so
  // the customer drops straight into the live session (Zoom card) instead of
  // the chat lingering over a connected call.
  useEffect(() => {
    const s = state.session;
    if (s && (ACTIVE_TIMER_STATES as readonly string[]).includes(s.status)) {
      setAsyncChatMode(false);
    }
  }, [state.session?.status]);

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

    // Defensive two-tier SELECT. The full query includes
    // completion_status + completed_at columns added by migration
    // 20260526110000_project_completion_retention.sql. If that
    // migration hasn't been applied to the customer's Supabase
    // project, the column-missing error makes the SELECT fail wholesale
    // — and the entire projects list stops refreshing (which surfaces
    // to the customer as "I created a project but it never appeared
    // in the sidebar"). Retry without those columns when they're
    // missing so the core sidebar functionality stays alive while the
    // retention feature degrades to "always active."
    const baseCols = "id, name, created_at, ai_summary_title, ai_summary_overview, ai_next_steps, summary, summary_updated_at";
    const fullCols = `${baseCols}, completion_status, completed_at`;

    let rows: Record<string, unknown>[] | null = null;
    let errored = false;
    const fullRes = await sb
      .from("projects")
      .select(fullCols)
      .eq("customer_id", state.auth.userId)
      .order("created_at", { ascending: false });
    if (fullRes.error) {
      // Column-missing errors are 42703. Treat ANY error here as a
      // signal to retry minimally — even a transient network error is
      // better served by a second attempt with fewer columns than by
      // bailing out and freezing the sidebar.
      console.warn(
        "[refetchProjects] full SELECT failed, retrying without retention cols:",
        fullRes.error.message,
      );
      const baseRes = await sb
        .from("projects")
        .select(baseCols)
        .eq("customer_id", state.auth.userId)
        .order("created_at", { ascending: false });
      if (baseRes.error) {
        console.warn("[refetchProjects] base SELECT also failed:", baseRes.error.message);
        errored = true;
      } else {
        rows = baseRes.data ?? [];
      }
    } else {
      rows = fullRes.data ?? [];
    }
    if (errored || rows == null) return;

    setProjects(rows.map((r) => ({
      id:                r.id as string,
      name:              r.name as string,
      createdAt:         r.created_at as string,
      aiSummaryTitle:    (r.ai_summary_title as string | null) ?? null,
      aiSummaryOverview: (r.ai_summary_overview as string | null) ?? null,
      aiNextSteps:       (Array.isArray(r.ai_next_steps) ? (r.ai_next_steps as string[]) : null),
      summary:           (r.summary as string | null) ?? null,
      summaryUpdatedAt:  (r.summary_updated_at as string | null) ?? null,
      // Default to "active" when the column wasn't returned (retention
      // migration not yet applied). The customer still sees their
      // project; the mark-complete flow just no-ops gracefully.
      completionStatus:  ((r.completion_status as string) === "completed" || (r.completion_status as string) === "archived")
                            ? (r.completion_status as "completed" | "archived")
                            : "active",
      completedAt:       (r.completed_at as string | null) ?? null,
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
    arg: ({ existingId: string } | { newName: string }) & { projectType?: string },
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
    let { data: intake } = await sb
      .from("client_intakes")
      .select("id")
      .eq("project_id", projectId)
      .eq("customer_user_id", userId)
      .maybeSingle();

    if (!intake) {
      // Legacy projects — created before client_intakes was written at
      // project-creation time. If we still have their metadata in
      // localStorage (writeProjectMetadata was always part of the
      // create flow), backfill the intake row inline so this customer
      // never has to see /intake again for this project. Otherwise
      // (truly intakeless), fall back to the wizard.
      const meta = readProjectMetadata(projectId);
      const profile = readProfile();
      if (meta) {
        const familiarity =
          profile.techComfort === "well_experienced"  ? "Well Experienced"
          : profile.techComfort === "semi_technical"  ? "Semi-Technical"
          : "Totally Unknown";
        const { data: newIntake, error: backfillErr } = await sb
          .from("client_intakes")
          .upsert(
            {
              customer_user_id: userId,
              project_id:       projectId,
              familiarity,
              ai_tools_used:    meta.aiTools.join(", ") || "Other",
              developing:       mapProjectTypeToDeveloping(meta.projectType),
              technologies:     [...meta.backend, ...meta.frontend],
              declined_by:      [] as string[],
            },
            { onConflict: "project_id,customer_user_id" },
          )
          .select("id")
          .single();
        if (!backfillErr && newIntake) {
          intake = newIntake as { id: string };
        }
      }
      if (!intake) {
        router.push(`/intake?projectId=${projectId}`);
        return;
      }
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
    // Selecting a project means the customer wants to see that project's
    // context — auto-close every side-track view so navigation feels
    // natural. Prep is included: clicking a different project's header
    // should drop the in-flight prep view, not silently keep it open.
    setAccountTab(null);
    setLegalView(null);
    setPreparingProjectId(null);
    setPreparingDraftId(null);
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
    // Opening / closing a past session: leave any side-track view behind.
    setAccountTab(null);
    setLegalView(null);
    setPreparingProjectId(null);
    setPreparingDraftId(null);
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
    // Starting a new session — exit any side-track view that was open.
    setAccountTab(null);
    setLegalView(null);
    setPreparingProjectId(null);
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
      // Pull per-project metadata if this session is starting in a
      // known existing project. Project-specific skills override the
      // customer's profile-level stack so the engineer matched is the
      // right specialist for THIS project, not whatever the customer
      // last worked on. (handleNewChat doesn't take a per-call override
      // argument — that's startSessionInProject's job. Was previously
      // copy-paste-referencing `arg.projectType` here, which doesn't
      // exist in this scope.)
      const projectMeta = projectId ? readProjectMetadata(projectId) : null;
      const aiToolsForIntake = projectMeta?.aiTools.length
        ? projectMeta.aiTools
        : profile.stack.aiTools;
      const backendForIntake = projectMeta?.backend.length
        ? projectMeta.backend
        : profile.stack.backend;
      const frontendForIntake = projectMeta?.frontend.length
        ? projectMeta.frontend
        : profile.stack.frontend;
      // Map persona project types ("Marketing landing page", "CRM /
      // Customer tracker", etc.) onto the four DB-allowed values
      // ("Website" / "Mobile App" / "IoT System" / "AIML product").
      // Without this, the upsert would fail the CHECK constraint and
      // the customer would never get an intake row.
      const developingForIntake = mapProjectTypeToDeveloping(projectMeta?.projectType);

      const intakePayload = {
        guest_call_id: session.id,
        customer_user_id: userId,
        project_id: projectId,
        familiarity,
        ai_tools_used: aiToolsForIntake.join(", ") || "Other",
        developing: developingForIntake,
        technologies: [...backendForIntake, ...frontendForIntake],
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

  // Recharge / "see plans" handler. Opens the Stripe paywall overlay
  // directly — the user-menu Recharge button is a transactional shortcut,
  // not a navigation. The in-pane Wallet tab (in AccountPane) still
  // shows the same paywall when its own Recharge button is hit, so
  // customers who want the fuller plan/billing view aren't blocked from
  // reaching it via Profile & settings → Wallet.
  const handleWalletClick = useCallback(() => {
    setPaywallOpen("manual");
  }, []);

  // Open the in-pane Account view on the Profile tab. Used by the user
  // menu's "Profile & settings" entry (replaces the old router.push to
  // a standalone /account route).
  const handleOpenProfile = useCallback(() => {
    setAccountTab("profile");
  }, []);

  // Open the in-pane Account view directly on the Billing tab. Same
  // shape as handleOpenProfile — the menu wants a quick shortcut so
  // customers don't have to land on Profile and click through.
  const handleOpenBilling = useCallback(() => {
    setAccountTab("billing");
  }, []);

  // Close the in-pane Account view and return to whatever was rendering
  // before (session, landing, past-session review, project picker).
  const handleCloseAccount = useCallback(() => {
    setAccountTab(null);
  }, []);

  // Open the in-pane legal viewer for Privacy / Terms. Closes the
  // Account pane if it was open — the two side-track views are
  // mutually exclusive in the centre column.
  const handleOpenLegal = useCallback((kind: LegalKind) => {
    setLegalView(kind);
    setAccountTab(null);
  }, []);
  const handleCloseLegal = useCallback(() => {
    setLegalView(null);
  }, []);

  // Prepare-session flow — open the central prep pane for a given
  // project so the customer can draft text / drop files / record
  // voice before ringing an engineer. Clears side-track views so the
  // central pane is fully theirs to draft in. The phone button next
  // to the project (handleStartInProject) is what actually rings.
  // Pass a draftId to re-open an existing saved draft for editing.
  const handlePrepareSession = useCallback((projectId: string, draftId?: string | null) => {
    setPreparingProjectId(projectId);
    setPreparingDraftId(draftId ?? null);
    setSelectedProjectId(projectId);
    setAccountTab(null);
    setLegalView(null);
    setViewingPastId(null);
  }, []);
  const handleClosePrepare = useCallback(() => {
    setPreparingProjectId(null);
    setPreparingDraftId(null);
  }, []);

  // Delete-project flow — opens the 2-factor confirmation modal.
  // The modal itself handles password verification, name confirmation,
  // and the literal "delete the project" phrase check before firing
  // the actual delete. Sessions whose project_id pointed at the
  // deleted row become orphaned (project_id → NULL via the FK's
  // ON DELETE SET NULL) and end up in the General bucket.
  const handleOpenDeleteProject = useCallback((projectId: string, projectName: string) => {
    setDeleteProjectTarget({ id: projectId, name: projectName });
  }, []);

  // Mark complete — flips the project to 'completed' which starts the
  // 90-day retention sweeper clock. Idempotent on the server side, so we
  // don't bother with a confirmation modal: the row is reversible via
  // mark_project_active until the sweeper actually archives it.
  const handleMarkProjectComplete = useCallback(async (projectId: string, projectName: string) => {
    const confirmed = typeof window !== "undefined"
      ? window.confirm(
          `Mark "${projectName}" complete?\n\n`
          + "This starts a 90-day retention clock. Files and chat history "
          + "stay accessible during that window — after 90 days the "
          + "attachments are removed (chat text stays). You can mark it "
          + "active again any time before then."
        )
      : true;
    if (!confirmed) return;
    const sb = createClient();
    const { error } = await sb.rpc("mark_project_complete", { _project_id: projectId });
    if (error) {
      if (typeof window !== "undefined") {
        window.alert(`Couldn't mark complete: ${error.message}`);
      }
      return;
    }
    await refetchProjects();
  }, [refetchProjects]);
  const handleCloseDeleteProject = useCallback(() => {
    setDeleteProjectTarget(null);
  }, []);
  const handleProjectDeleted = useCallback(async (projectId: string) => {
    // Clean up local-only state tied to the project: drafts in the
    // sidebar, project metadata (skills/aiTools/etc), any in-flight
    // prep view, selection. Then refetch projects to drop the row
    // from the sidebar.
    try { deleteDraftsForProject(projectId); } catch { /* swallow */ }
    try { deleteProjectMetadata(projectId); } catch { /* swallow */ }
    setSelectedProjectId((prev) => (prev === projectId ? null : prev));
    setPreparingProjectId((prev) => (prev === projectId ? null : prev));
    setPreparingDraftId(null);
    setDeleteProjectTarget(null);
    bumpDrafts();
    await refetchProjects();
  }, [refetchProjects, bumpDrafts]);

  // Home — return to the landing surface from anywhere in /room.
  // Clears every side-track view (account, legal, past-session
  // review, project picker) and any project selection so the
  // BrandedLanding renders with its default "no project picked"
  // explainer. If a session is actively running, the chat pane will
  // re-render on top (active session always wins the centre column);
  // ending the session naturally drops the customer onto the
  // landing. We deliberately don't end the session here — Home
  // navigates, it doesn't destroy state.
  const handleGoHome = useCallback(() => {
    setAccountTab(null);
    setLegalView(null);
    setViewingPastId(null);
    setProjectFormOpen(false);
    setSelectedProjectId(null);
    setPendingDraft(null);
    setPreparingProjectId(null);
    setPreparingDraftId(null);
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

  // Connect-flow new-project path: persist customer's stack choices,
  // create project with the chosen name, write per-project metadata
  // for future engineer matching, AND start a session immediately.
  // Equivalent of "+ Create New Project" but with the engineer ring
  // bolted on.
  const handleStartNewProject = useCallback(async (opts: {
    name: string;
    projectType: string;
    aiTools: string[];
    backend: string[];
    frontend: string[];
  }) => {
    writeStack({
      aiTools: opts.aiTools,
      backend: opts.backend,
      frontend: opts.frontend,
    });
    const existing = readProfile();
    if (!existing.techComfort) {
      patchProfile({ techComfort: "non_technical" });
    }
    // startSessionInProject creates the project, the guest_call, the
    // client_intake, AND fires match_engineer. Its return value isn't
    // currently the project id (it just throws on error); we'll capture
    // the new project id from the post-RPC projects refetch below in
    // order to write per-project metadata. For now, write the metadata
    // BEFORE the call using a placeholder key, then rebind after.
    await startSessionInProject({
      newName: opts.name,
      projectType: opts.projectType,
    });
    // After startSessionInProject completes, the projects list refetch
    // (triggered inside the helper) lands. We look up the newly-created
    // project by name (most recent) and pin metadata to its id so that
    // future sessions started from the phone-on-project shortcut hit
    // the right matching profile.
    setTimeout(() => {
      const latest = [...projects].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ).find((p) => p.name === opts.name);
      if (latest?.id) {
        writeProjectMetadata(latest.id, {
          projectType: opts.projectType,
          aiTools: opts.aiTools,
          backend: opts.backend,
          frontend: opts.frontend,
        });
      }
    }, 600);
  }, [startSessionInProject, projects]);

  // Plain create-project path (the "+ Create New Project" button). Creates
  // a project with the user's chosen name + metadata via create_project
  // RPC. Does NOT start a session or ring an engineer — the customer
  // initiates that separately via the phone button on the project row,
  // or the top-of-sidebar Connect button.
  const handleCreateProjectWithMetadata = useCallback(async (opts: {
    name: string;
    projectType: string;
    aiTools: string[];
    backend: string[];
    frontend: string[];
  }) => {
    const sb = createClient();
    const { data, error } = await sb.rpc("create_project", { _name: opts.name });
    if (error) {
      console.warn("[handleCreateProjectWithMetadata] create_project failed:", error.message);
      throw new Error(error.message);
    }
    const row = Array.isArray(data) ? (data[0] as { id?: string }) : (data as { id?: string });
    const projectId = row?.id ?? null;
    if (projectId) {
      writeProjectMetadata(projectId, {
        projectType: opts.projectType,
        aiTools: opts.aiTools,
        backend: opts.backend,
        frontend: opts.frontend,
      });
    }
    // Also snapshot to the customer's profile so the global "Connect"
    // button (which uses profile-level stack) reflects the most recent
    // declared stack.
    writeStack({
      aiTools: opts.aiTools,
      backend: opts.backend,
      frontend: opts.frontend,
    });
    const existing = readProfile();
    if (!existing.techComfort) {
      patchProfile({ techComfort: "non_technical" });
    }

    // ── Write the client_intakes row up-front ────────────────────────────
    // The form already collected every signal the engineer needs to
    // match (project type → developing, AI tools, backend, frontend).
    // Persisting that to client_intakes NOW means a later phone-click
    // on this project can short-circuit straight to match_engineer
    // instead of bouncing through the "Picking up where you left off"
    // intake wizard. guest_call_id stays null until a session actually
    // mints; the wizard's upsert (handleStartInProject, onConflict
    // project_id+customer_user_id) updates the same row with a session
    // id at ring time.
    const userId = state.auth.kind === "authed" ? state.auth.userId : null;
    if (projectId && userId) {
      const techComfort = readProfile().techComfort ?? "non_technical";
      const familiarity =
        techComfort === "well_experienced"  ? "Well Experienced"
        : techComfort === "semi_technical"  ? "Semi-Technical"
        : "Totally Unknown";
      const intakePayload = {
        customer_user_id: userId,
        project_id:       projectId,
        familiarity,
        ai_tools_used:    opts.aiTools.join(", ") || "Other",
        developing:       mapProjectTypeToDeveloping(opts.projectType),
        technologies:     [...opts.backend, ...opts.frontend],
        declined_by:      [] as string[],
      };
      const { error: intakeErr } = await sb
        .from("client_intakes")
        .upsert(intakePayload, { onConflict: "project_id,customer_user_id" });
      if (intakeErr) {
        console.warn("[handleCreateProjectWithMetadata] intake upsert failed:", intakeErr.message);
        // Non-fatal — the project still exists, future phone-clicks
        // will route through /intake as a fallback.
      }
    }

    await refetchProjects();
  }, [refetchProjects, state.auth]);
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
        onStartNewProject={handleStartNewProject}
        onCreateProjectWithMetadata={handleCreateProjectWithMetadata}
        onSelectProject={handleSelectProject}
        onWalletClick={handleWalletClick}
        onOpenProfile={handleOpenProfile}
        onOpenBilling={handleOpenBilling}
        onOpenLegal={handleOpenLegal}
        onGoHome={handleGoHome}
        onPrepareSession={handlePrepareSession}
        draftsTick={draftsTick}
        onDeleteProject={handleOpenDeleteProject}
        onPickerToast={(msg) => {
          // Surface a 5-second confirmation toast from inside the
          // engineer picker. Reuses the paidToast slot since both
          // are short-lived "we did the thing" notifications; only
          // one of them is ever active at a time in practice.
          setPaidToast(msg);
          window.setTimeout(() => setPaidToast(null), 5000);
        }}
        onMarkProjectComplete={handleMarkProjectComplete}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Floating status / timer chip + end-meeting button (top-right) */}
        <FloatingStatus
          session={state.session}
          entitlement={state.entitlement}
          accepted={accepted}
          onEnd={state.end}
          onJoin={() => void state.markJoined()}
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
            accountTab={accountTab}
            onCloseAccount={handleCloseAccount}
            legalView={legalView}
            onCloseLegal={handleCloseLegal}
            preparingProjectId={preparingProjectId}
            preparingDraftId={preparingDraftId}
            onClosePrepare={handleClosePrepare}
            onDraftsChanged={bumpDrafts}
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

      {/* 2-factor delete-project confirmation. The modal does the
          password verification + name + literal-phrase checks; the
          actual destructive work runs in onConfirm here. */}
      {deleteProjectTarget && state.auth.kind === "authed" && (
        <DeleteProjectModal
          projectId={deleteProjectTarget.id}
          projectName={deleteProjectTarget.name}
          customerEmail={state.auth.email}
          onClose={handleCloseDeleteProject}
          onConfirm={async (projectId) => {
            // 1. Delete the project row. The FK on guest_calls.project_id
            //    is ON DELETE SET NULL, so sessions get orphaned to the
            //    General bucket rather than cascade-deleted. RLS guards
            //    that the customer owns the project (customer_id =
            //    auth.uid()), so this only succeeds for their own rows.
            const sb = createClient();
            const { error: delErr } = await sb
              .from("projects")
              .delete()
              .eq("id", projectId);
            if (delErr) throw new Error(delErr.message);

            // 2. Local-only cleanup (drafts, project metadata, any
            //    in-flight selection / prep view).
            await handleProjectDeleted(projectId);
          }}
        />
      )}

      <GlobalNewChatModal
        open={newChatModalOpen}
        onClose={() => setNewChatModalOpen(false)}
        projects={projects}
        onPickProject={(id) => { setNewChatModalOpen(false); void handleStartInProject(id); }}
        onAddProject={() => { setNewChatModalOpen(false); router.push("/intake"); }}
        onAsyncChat={() => { setNewChatModalOpen(false); void handleNewChat(); }}
      />

      {/* ScheduleEngineerModal is mounted inside Sidebar since the schedule
          target state lives there (driven by the connect-flow modal). */}

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
  accountTab, onCloseAccount, legalView, onCloseLegal,
  preparingProjectId, preparingDraftId, onClosePrepare, onDraftsChanged,
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
  /** In-pane Account tab to render (Profile / Wallet / Billing /
   *  Security / Notifications), or null to render the normal session-
   *  driven view. */
  accountTab: null | "profile" | "wallet" | "billing" | "security" | "notifications";
  /** Close the AccountPane — falls back to the prior view. */
  onCloseAccount: () => void;
  /** In-pane legal viewer (Privacy / Terms) or null for the normal view. */
  legalView: LegalKind | null;
  /** Close the legal viewer — falls back to the prior view. */
  onCloseLegal: () => void;
  /** Project id whose "Prepare a session" pane is being drafted in the
   *  centre. Null = no prep view active. */
  preparingProjectId: string | null;
  /** When re-opening an existing saved draft, the draft's id. Null
   *  for a fresh new-draft session. */
  preparingDraftId: string | null;
  /** Close the prep view — falls back to the landing. */
  onClosePrepare: () => void;
  /** Notify the parent that the drafts list changed so the sidebar
   *  re-reads from localStorage. */
  onDraftsChanged: () => void;
}) {
  const session = state.session;

  // Auto-close the prep view if its project disappears between renders
  // (deleted in another tab, archived, etc). Runs as an effect AFTER
  // render so we don't synchronously call setState on the parent
  // (RoomClient) during MainPane's render — React's "Cannot update a
  // component while rendering a different component" warning was
  // firing because the previous version called onClosePrepare() inline
  // inside the render branch below.
  useEffect(() => {
    if (!preparingProjectId) return;
    if (!projects.find((p) => p.id === preparingProjectId)) {
      onClosePrepare();
    }
  }, [preparingProjectId, projects, onClosePrepare]);

  // ── Legal viewer: highest priority. Privacy / Terms documents take
  // over the centre column completely (no chat stub on the right) so
  // the customer has uninterrupted reading width. Mounted before the
  // Account pane because the user can deep-link into the legal viewer
  // from inside Account → Notifications too.
  if (legalView) {
    return <LegalPane kind={legalView} onClose={onCloseLegal} />;
  }

  // ── Account pane: when the customer opened Profile/Wallet/Security ──────
  // High priority because we want the account UI to fully take over the
  // pane — including suppressing the WhatsApp chat stub — so they have room
  // to actually edit their settings.
  if (accountTab && state.auth.kind === "authed") {
    return (
      <AccountPane
        userId={state.auth.userId}
        email={state.auth.email}
        initialTab={accountTab}
        onClose={onCloseAccount}
      />
    );
  }

  // ── Session prep: customer clicked + next to a project. Takes over
  // the central pane so they have room to draft their problem before
  // ringing the engineer. Falls back gracefully (closes prep) if the
  // project disappears (e.g., archived in another tab). */
  if (preparingProjectId) {
    const prepProject = projects.find((p) => p.id === preparingProjectId);
    if (prepProject) {
      return (
        <SessionPrepView
          project={prepProject}
          draftId={preparingDraftId}
          onCallEngineer={() => onStartInProject(preparingProjectId)}
          onClose={onClosePrepare}
          onDraftsChanged={onDraftsChanged}
        />
      );
    }
    // Project not found this render — the useEffect above will clear
    // preparingProjectId after the commit, triggering a re-render that
    // falls through to the landing. For THIS render, fall through
    // silently (no setState during render).
  }

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
    return (
      <PastSessionReview
        sessionId={viewingPastId}
        onClose={onCloseViewPast}
        currentUserId={state.auth.kind === "authed" ? state.auth.userId : null}
      />
    );
  }

  // Just-ended session: same split as PastSessionReview so the layout
  // stays consistent across "live session that just ended" and "past
  // session opened from the sidebar." Center = AI summary (70%),
  // right = WhatsApp chat stub (30%, inactive — there's no live call).
  // The actual chat history during the call rolls into the AI summary,
  // so the customer doesn't lose anything by not seeing the timeline.
  if (session?.status === "ended") {
    return (
      <EndedSessionReview
        session={session}
        messages={state.messages}
        currentUserId={state.auth.kind === "authed" ? state.auth.userId : null}
      />
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

// (Earlier iterations of BrandedLanding had a set of card helper
//  components — LegendCard / StateCard / SpatialCard / FlowStep — that
//  wrapped each explainer row in its own bordered box. Removed in
//  favor of inline, chrome-light rendering directly in BrandedLanding
//  so the page reads less like a dashboard widget and more like a
//  polished spec page.)

// ── Session prep view ─────────────────────────────────────────────────
// Customer hit the + next to a project in the sidebar. Drafts persist
// to localStorage via lib/relay/sessionDrafts so they survive across
// browser sessions and show up under the project in the sidebar as
// distinctive "DRAFT" rows.
//
// Two entry modes:
//   • New draft   — preparingDraftId is null. Local text held in state;
//                   "Save for later" promotes it into a stored draft row.
//   • Edit saved  — preparingDraftId points at an existing stored row.
//                   Edits update the row in-place (autosave on debounce);
//                   "Call engineer" deletes the draft + rings.
//
// TODO[engineer-prep-handoff]: when "Call engineer" mints the live
// session, post the prep text as the opening guest_message so the
// engineer walks in with the context already in front of them. The
// draft entry then gets deleted (it's been promoted).
function SessionPrepView({
  project,
  draftId,
  onCallEngineer,
  onClose,
  onDraftsChanged,
}: {
  project: Project;
  /** Stored draft id when re-opening an existing draft; null for a
   *  fresh new-draft session. */
  draftId: string | null;
  /** Ring the engineer — wires to handleStartInProject(project.id).
   *  Same routing as the project's sidebar phone button. Caller should
   *  also delete the underlying draft (we do this in onCallEngineer
   *  inside the prep view itself so the side effect is local). */
  onCallEngineer: () => void;
  /** Close the prep view, back to the landing. */
  onClose: () => void;
  /** Notify the parent that the drafts list changed so the sidebar
   *  re-reads from localStorage. Fired on save + delete. */
  onDraftsChanged: () => void;
}) {
  // Seed text from the stored draft if we're editing one, else blank.
  const [draft, setDraft] = useState<string>(() => {
    if (!draftId) return "";
    return readSessionDraft(draftId)?.text ?? "";
  });
  // Tracks the id of the currently-saved draft (null until first save).
  const [savedId, setSavedId] = useState<string | null>(draftId);
  const [savedAt, setSavedAt] = useState<number | null>(() => {
    if (!draftId) return null;
    return readSessionDraft(draftId)?.updatedAt ?? null;
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave: any time draft text changes and we have a saved id,
  // push the update to localStorage on a 400ms debounce so we don't
  // hammer storage on every keystroke. New (unsaved) drafts wait for
  // the explicit Save click — autosave is opt-in.
  useEffect(() => {
    if (!savedId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const updated = saveSessionDraft({
        id: savedId,
        projectId: project.id,
        text: draft,
      });
      setSavedAt(updated.updatedAt);
      onDraftsChanged();
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, savedId, project.id, onDraftsChanged]);

  // Promote an unsaved draft into the saved list, OR force a save of
  // the current debounce buffer if the row already exists. After
  // this fires the draft shows up in the sidebar under its project.
  const handleSaveForLater = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = draft.trim();
    if (!trimmed) {
      // Empty save = no-op (don't create empty rows in the sidebar).
      return;
    }
    const row = saveSessionDraft({
      id: savedId,
      projectId: project.id,
      text: draft,
    });
    setSavedId(row.id);
    setSavedAt(row.updatedAt);
    onDraftsChanged();
    onClose();
  }, [draft, savedId, project.id, onDraftsChanged, onClose]);

  // Call engineer = ring + consume the draft. We delete the draft row
  // first (since it's about to become a live session), then trigger
  // the actual ring via the parent callback. If the parent flow fails
  // partway, the draft is gone — that's a trade-off for keeping the
  // sidebar clean and not leaving stale "draft of an active session"
  // rows behind. TODO: flush the draft text into the live session's
  // first message in the parent handler (engineer-prep-handoff).
  const handleCall = useCallback(() => {
    if (savedId) {
      deleteSessionDraft(savedId);
      onDraftsChanged();
    }
    onCallEngineer();
  }, [savedId, onDraftsChanged, onCallEngineer]);

  const handleDeleteDraft = useCallback(() => {
    if (savedId) {
      deleteSessionDraft(savedId);
      onDraftsChanged();
    }
    setDraft("");
    setSavedId(null);
    setSavedAt(null);
    onClose();
  }, [savedId, onDraftsChanged, onClose]);

  const isExisting = !!savedId;
  const lastSavedLabel = savedAt
    ? `Saved ${new Date(savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "Not saved yet — hit Save for later to keep this draft.";

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      {/* Header — project name + close. */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-6 py-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <Folder size={14} style={{ color: "var(--primary)" }} />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
              {isExisting ? "Editing draft in" : "Preparing a session in"}
            </div>
            <div className="truncate text-[15px] font-semibold" style={{ color: "var(--text)" }}>
              {project.name}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close prep"
          title="Close"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-opacity hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <h2
            className="text-[20px] font-semibold tracking-tight"
            style={{ color: "var(--text)", fontFamily: "var(--font-source-serif)" }}
          >
            Tell the engineer what you&apos;re working on.
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
            Take your time. Drop the context, the bug, the goal — whatever helps. When
            you&apos;re ready, hit <strong style={{ color: "var(--text)" }}>Call engineer</strong>{" "}
            and they&apos;ll walk in with this in front of them. Or save it for later and
            come back any time — your drafts live under the project in the sidebar.
          </p>

          <div
            className="mt-5 rounded-2xl border p-4"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              placeholder={"What are you trying to do?\nWhat's going wrong?\nAny files / repos / screenshots you want them to see?"}
              className="block w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:opacity-50"
              style={{ color: "var(--text)" }}
            />

            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                disabled
                aria-label="Attach file"
                title="Attachments will travel with the call (coming soon)"
                className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-full opacity-50"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
              >
                <Paperclip size={14} />
              </button>
              <button
                type="button"
                disabled
                aria-label="Record voice"
                title="Voice notes will travel with the call (coming soon)"
                className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-full opacity-50"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
              >
                <Mic size={14} />
              </button>
              <div className="flex-1" />
              {isExisting && (
                <button
                  type="button"
                  onClick={handleDeleteDraft}
                  className="text-[11px] underline-offset-2 hover:underline"
                  style={{ color: "var(--accent-red)" }}
                >
                  Delete draft
                </button>
              )}
            </div>
          </div>

          {/* Action row — Save for later (secondary) on the left,
              Call engineer (primary) on the right. The status text
              between them tells the customer whether anything has been
              persisted yet so they don't accidentally close on an
              unsaved draft. */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>
              {lastSavedLabel}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveForLater}
                disabled={!draft.trim()}
                className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }}
              >
                <Pencil size={11} />
                Save for later
              </button>
              <button
                type="button"
                onClick={handleCall}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
              >
                <Phone size={13} strokeWidth={2.4} />
                Call engineer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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

      {/* Centre: Relay wordmark + tagline. Marketing CTA removed.
          When a session is active, the customer is routed to ChatPane —
          this no-session landing is intentionally calm. If a project is
          selected via the sidebar, a small "Working in {project}" chip
          surfaces below the logo as quiet context. */}
      <div className="relative flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-3xl flex-col items-center text-center">
          <Wordmark size="lg" />

          {/* Brand tagline — "human layer" italicized + brand-green, with
              an animated underline that sweeps a bright dot left-to-right
              along a faint green base. The animation reinforces the
              "still alive, waiting" feeling of the no-session landing. */}
          <p
            className="mt-5 text-[18px] leading-snug"
            style={{ color: "var(--text-muted)" }}
          >
            <span className="relay-tagline-glow">
              The{" "}
              <em
                style={{
                  color: "var(--primary)",
                  fontStyle: "italic",
                  fontWeight: 500,
                }}
              >
                human layer
              </em>
              {" "}for AI-built software.
            </span>
          </p>

          {hasProject && (
            <div className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 shadow-sm">
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
          )}

          {/* Horizontal separator between the wordmark/tagline pair
              (above) and the explainer below. Quiet visual break only —
              the explainer that follows is intentionally chrome-light. */}
          <div
            aria-hidden
            className="mt-8 h-px w-full max-w-md"
            style={{ backgroundColor: "var(--border)" }}
          />

          {/* How-it-works explainer — chrome-light redesign. Same
              content as the prior card-heavy version, but the visual
              weight comes from typography + whitespace + tiny color
              accents rather than nested bordered boxes. Single-column
              rhythm with one 2-column moment for the spatial
              left↔right reference. Reads like a polished spec page,
              not a dashboard widget. */}
          <div className="mt-8 w-full text-left text-[15px] leading-relaxed" style={{ color: "var(--text-muted)" }}>

            {/* ── 1. Phone icon legend — two clean rows, no card chrome ── */}
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: "#0a0a0a",
                    color: "#ffffff",
                    // Thin white ring keeps the black circle legible on
                    // dark + espresso themes (otherwise it disappears
                    // into the canvas). Low-alpha so it doesn't shout
                    // on the light theme either.
                    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.45)",
                  }}
                >
                  <Phone size={13} />
                </span>
                <div>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>Black</span>
                  {" — "}
                  No engineer yet. Tap to match a stack-fit engineer; on the call in under a minute.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
                >
                  <Phone size={13} />
                </span>
                <div>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>Green</span>
                  {" — "}
                  Worked here before. Priority routes to them — swap to any other engineer any time.
                </div>
              </div>
            </div>

            {/* Hairline divider between sections — much lighter than a card border */}
            <div className="my-6 h-px w-full" style={{ backgroundColor: "color-mix(in srgb, var(--border) 50%, transparent)" }} />

            {/* ── 2. Availability states — small section header + inline pills ── */}
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
              When you tap a green icon
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                <span style={{ color: "var(--text)", fontWeight: 600 }}>Online</span>
                <span style={{ color: "var(--text-muted)" }}>— instant call, under a minute</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--warn)" }} />
                <span style={{ color: "var(--text)", fontWeight: 600 }}>Busy</span>
                <span style={{ color: "var(--text-muted)" }}>— drop a request, joins after</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--text-faint)" }} />
                <span style={{ color: "var(--text)", fontWeight: 600 }}>Offline</span>
                <span style={{ color: "var(--text-muted)" }}>— book their calendar</span>
              </span>
            </div>
            <p className="mt-3 text-[14px]">
              Don't want to wait? Pick anyone else — every engineer arrives with full project memory and an AI brief. Zero ramp-up.
            </p>

            <div className="my-6 h-px w-full" style={{ backgroundColor: "color-mix(in srgb, var(--border) 50%, transparent)" }} />

            {/* ── 3. Spatial UI orientation — two columns, no boxes ─── */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--primary)" }}>
                  ← Left sidebar
                </div>
                <div className="mt-1.5 text-[16px] font-semibold" style={{ color: "var(--text)" }}>
                  Project memory
                </div>
                <p className="mt-1.5 text-[14px]">
                  Every session, file, voice note, and AI summary stays with the project — not the call. New engineers join with full history. No catch-up.
                </p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--primary)" }}>
                  Right panel →
                </div>
                <div className="mt-1.5 text-[16px] font-semibold" style={{ color: "var(--text)" }}>
                  Live chat
                </div>
                <p className="mt-1.5 text-[14px]">
                  Type, attach files, record voice notes. The panel goes live when your engineer joins — anything written before is saved as a draft for them.
                </p>
              </div>
            </div>

            <div className="my-6 h-px w-full" style={{ backgroundColor: "color-mix(in srgb, var(--border) 50%, transparent)" }} />

            {/* ── 4. Numbered lifecycle — single column, simple rows ── */}
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
              How it works
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
                >
                  1
                </span>
                <div>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>Connect</span>
                  {" — "}
                  Tap a phone icon. Engineer accepts → Zoom opens with voice, chat, and screen share in one shot.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
                >
                  2
                </span>
                <div>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>Build</span>
                  {" — "}
                  Work together live. Everything stays searchable in the chat panel afterwards — no notes lost.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
                >
                  3
                </span>
                <div>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>Ship</span>
                  {" — "}
                  Hand the project off when you're ready. Your engineer keeps maintaining and enhancing it for as long as you need.
                </div>
              </div>
            </div>

            {/* ── 5. Pricing footnote ─────────────────────────────── */}
            <p className="mt-8 text-center text-[13px]" style={{ color: "var(--text-faint)" }}>
              Pay per minute. No subscription, no auto-renew.
            </p>
          </div>
        </div>
      </div>

      {/* Right rail: WhatsApp-style chat panel (30% width). Inactive in
          this view (no live session yet). The composer is disabled and a
          placeholder explains the activation rule. When a live session
          starts, the customer is routed to ChatPane which has the real
          live-chat experience — this panel is the "no session yet"
          mirror, so the customer sees where chat WILL happen.

          TODO(live-wire): when a session is active or being viewed, this
          panel can show the live message stream + an active composer.
          Currently the live path renders ChatPane in place of the whole
          MainPane via the parent switch (see MainPane), so this panel
          only ever shows in the no-session landing. */}
      <ChatPanelStub
        sidebarCollapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      />
    </div>
  );
}

// ── Chat panel (pre-session drafting surface) ───────────────────────────
// WhatsApp-styled chat surface shown when no live engineer call exists.
// Now functional as a local-only draft buffer: customer can type
// messages + dictate via voice while waiting for an engineer. Messages
// land in the area above the composer and auto-scroll into view when
// the buffer overflows the available height.
//
// Persistence: messages are kept in `sessionStorage` keyed by user, so
// a refresh doesn't erase the draft, but a sign-out / cross-device hop
// resets it. When a live engineer joins (future wiring — see
// TODO[live-sync] below), these drafts can be flushed into the real
// guest_messages stream as the customer's opening turn.
//
// Why local-only for now: there's no engineer yet, so there's no recipient
// and no guest_call_id to attach to. The user wants the visual experience
// of a chat surface today; the sync happens when we have a target.
type LocalDraftMessage = {
  id: string;
  text: string;
  createdAt: number;       // epoch ms — sorts independently of network state
  /** Epoch ms of the most recent edit. null/undefined for never-edited.
   *  Drives the "(edited)" badge next to the timestamp. */
  editedAt?: number | null;
};

const STUB_DRAFT_STORAGE_KEY = "relay-chat-stub-draft-v1";

// (Edit + Delete are always available on local-only stub drafts —
//  there's no recipient yet, so the WhatsApp-style "you can't unsend
//  once the other side has seen it" time limit doesn't model anything
//  real. A time limit was attempted earlier; users hit "where's the
//  edit button?" the moment it expired and the kebab vanished.)

// Two timestamps fall on the same calendar day in the user's locale.
function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth()    === db.getMonth() &&
    da.getDate()     === db.getDate()
  );
}

// Centered date pill — WhatsApp's day-divider equivalent.
function DateSeparatorPill({ ts }: { ts: number }) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  let label: string;
  if (sameDay(ts, today.getTime())) label = "Today";
  else if (sameDay(ts, yesterday.getTime())) label = "Yesterday";
  else label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: today.getFullYear() === d.getFullYear() ? undefined : "numeric" });
  return (
    <div className="my-2 flex justify-center">
      <span
        className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// One outgoing chat bubble with WhatsApp parity:
//   • A kebab to the LEFT of the bubble (outside) always visible at
//     opacity-70, full on hover — opens an Edit / Delete menu
//   • Bottom-right of bubble: time + "(edited)" + single check tick
//   • Inline edit mode: textarea replaces the static text, Save/Cancel
//     buttons + Enter / Esc shortcuts
//   • Enter animation: small slide-up + fade so each new bubble feels
//     posted rather than spawned in place
//   • Press-and-hold (long-press) opens the menu on touch devices
//
// Edit + delete have no time limit on local-only drafts — the WhatsApp
// "delete-for-everyone" window only makes sense when the message has
// been transmitted to a recipient. These drafts live on this device
// until the engineer joins, so the customer can always edit/delete.
function DraftBubble({
  message, menuOpen, editing, editText, onEditTextChange,
  onOpenMenu, onCloseMenu, onStartEdit, onSaveEdit, onCancelEdit, onDelete,
}: {
  message: LocalDraftMessage;
  menuOpen: boolean;
  editing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when edit mode opens.
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      // Move caret to end of existing text — same UX as WhatsApp's
      // "Edit message" tap: the user can start typing immediately
      // without re-positioning the caret manually.
      const len = editRef.current.value.length;
      editRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const startHold = () => {
    if (editing) return;
    holdTimer.current = setTimeout(() => {
      onOpenMenu();
      holdTimer.current = null;
    }, 450);
  };
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  return (
    <div
      className="group relative flex items-start justify-end gap-1.5"
      style={{ animation: editing ? undefined : "relay-bubble-in 180ms ease-out" }}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
    >
      {/* Kebab button — lives OUTSIDE the bubble's left edge so it's
          clearly its own affordance and doesn't fight the scrollbar
          on the right. Always visible at opacity-70 (full on hover /
          when its menu is open) so users can find it without guessing
          there's a hover-only secret. h-7 makes it tappable on touch. */}
      {!editing && (
        <div className="relative mt-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              menuOpen ? onCloseMenu() : onOpenMenu();
            }}
            aria-label="Message options"
            title="Edit / delete"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border transition-opacity",
              menuOpen ? "opacity-100" : "opacity-70 group-hover:opacity-100 focus:opacity-100",
            )}
            style={{
              backgroundColor: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full z-20 mt-1 min-w-[150px] overflow-hidden rounded-lg border shadow-xl"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              }}
            >
              <button
                type="button"
                onClick={onStartEdit}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: "var(--text)" }}
              >
                <Pencil size={12} />
                Edit message
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: "var(--accent-red)" }}
              >
                <X size={12} />
                Delete message
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className="relative max-w-[78%] rounded-2xl px-3 py-2 text-[13px] leading-snug"
        style={{
          backgroundColor: "var(--primary-tint)",
          color: "var(--text)",
          borderTopRightRadius: 4,
        }}
      >
        {editing ? (
          // Inline edit mode — textarea replaces the static text.
          // Enter saves (Shift+Enter inserts newline, Esc cancels);
          // explicit Save / Cancel buttons mirror WhatsApp's
          // edit-message footer for users who'd rather click.
          <>
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSaveEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit();
                }
              }}
              rows={Math.min(8, Math.max(1, editText.split("\n").length))}
              className="block w-full resize-none rounded-md border bg-transparent px-2 py-1 text-[13px] leading-snug outline-none"
              style={{
                borderColor: "var(--border)",
                color: "var(--text)",
                backgroundColor: "color-mix(in srgb, var(--surface) 60%, transparent)",
                minWidth: 180,
              }}
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
              >
                <Check size={10} /> Save
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="whitespace-pre-wrap break-words pr-1">{message.text}</div>
            <div
              className="mt-0.5 flex items-center justify-end gap-1 text-[9px]"
              style={{ color: "var(--text-muted)" }}
            >
              {/* "edited" badge appears once the bubble has been edited.
                  WhatsApp uses the same word in the same place. */}
              {message.editedAt && (
                <span className="italic opacity-70">edited</span>
              )}
              <span>
                {new Date(message.createdAt).toLocaleTimeString("en-US", {
                  hour: "numeric", minute: "2-digit",
                })}
              </span>
              {/* Single tick = saved locally. We'll show ✓✓ in green once
                  the engineer actually receives + reads the message in a
                  future live-sync wire-up. */}
              <Check size={10} style={{ opacity: 0.75 }} />
            </div>
          </>
        )}

      </div>
    </div>
  );
}

function ChatPanelStub({
  sidebarCollapsed, onToggleCollapsed, session,
}: {
  sidebarCollapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * Optional session context — when set, the header shows the engineer's
   * name + a live/ended subtitle instead of the generic "Engineer chat /
   * No active session" copy. Used by EndedSessionReview and
   * PastSessionReview to give the right panel a real identity.
   *
   * Live sessions never use this component (ChatPane renders instead),
   * so the live/joining/assigned/grace cases here only get hit if a
   * future caller wires the stub against an active session.
   */
  session?: GuestCall | null;
}) {
  // Derive the header copy from session state. Three branches:
  //   • live-ish + engineer named  → "Chatting with X" / "Live now"
  //   • ended-ish + engineer named → "You chatted with X" / "Session ended"
  //   • no session OR no name yet  → "Engineer chat" / "No active session"
  // The "no name yet" fallback is important during the assigned→joining
  // window when claimed_by is set but agent_name hasn't synced down.
  const engineerName = session?.agent_name?.trim() || null;
  const status = session?.status ?? null;
  const isLiveish = !!status && ["assigned", "joining", "live", "grace"].includes(status);
  const isEndedish = !!status && ["ended", "cancelled", "abandoned"].includes(status);
  const headerTitle =
    isLiveish && engineerName ? `Chatting with ${engineerName}` :
    isEndedish && engineerName ? `You chatted with ${engineerName}` :
    "Engineer chat";
  const headerSubtitle =
    isLiveish ? "Live now" :
    isEndedish ? "Session ended" :
    "No active session";
  const [messages, setMessages] = useState<LocalDraftMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.sessionStorage.getItem(STUB_DRAFT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LocalDraftMessage[];
      return Array.isArray(parsed) ? parsed.slice(-200) : [];
    } catch {
      return [];
    }
  });
  const [draftText, setDraftText] = useState("");
  const [voiceMode, setVoiceMode] = useState<"idle" | "transcribing">("idle");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  // Undo window: tracks the message id that's still inside its 5-second
  // delete-after-send grace period. WhatsApp's "Delete for everyone"
  // window is hours-long because the message has been relayed to other
  // devices; ours is short because the message is just sitting in local
  // sessionStorage and there's no recipient to "unsend" from.
  const [undoableId, setUndoableId] = useState<string | null>(null);
  // Open-on-hover/click menu — which message has its kebab menu open.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Pending undo timer ref so a fresh send replaces the previous timer.
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Inline edit state: which bubble is in edit mode + its draft text.
  // Only one bubble can be in edit at a time so the customer doesn't
  // lose track of partial-edit context across multiple messages.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText]   = useState("");

  // Pending attachments (files picked + voice notes recorded BEFORE a
  // session exists). Persisted to IndexedDB via stubDraftAttachments
  // so a tab refresh keeps them around. We hold only metadata in
  // React state — the actual Blob bytes live in IDB. flushed to the
  // first session that goes live by the parent's auto-flush effect.
  const [stubAttachments, setStubAttachments] = useState<StubAttachmentMeta[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Voice-recording state: idle | recording. Mirrors the real
  // ChatComposer's tap-to-record affordance without the tap-vs-hold
  // gesture (this is a separate button from dictate, not the same one).
  const [recState, setRecState] = useState<"idle" | "recording">("idle");
  const recorderRef       = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);

  const recognitionRef = useRef<{
    abort: () => void;
    stop: () => void;
  } | null>(null);
  const transcribeBaseRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate the pending-attachments tray on mount.
  useEffect(() => {
    let alive = true;
    void stubListAttachments().then((items) => {
      if (alive) setStubAttachments(items);
    });
    return () => { alive = false; };
  }, []);

  // Persist messages so a tab refresh doesn't erase the draft buffer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STUB_DRAFT_STORAGE_KEY,
        JSON.stringify(messages.slice(-200)),
      );
    } catch { /* quota / privacy mode — local-only, swallow */ }
  }, [messages]);

  // Auto-scroll the message area to the bottom when a new message arrives.
  // Only auto-scrolls when the user is already near the bottom — if they've
  // scrolled up to read history, a new incoming message shouldn't yank them
  // back down. ~120px from bottom is the heuristic threshold.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (dist < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleSendDraft = useCallback(() => {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    const newId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: newId, text: trimmed, createdAt: Date.now() },
    ]);
    setDraftText("");

    // Start the 5-second undo window. Any pending earlier timer gets
    // cleared so the most recently-sent message is the one that's
    // undoable — the snackbar always reflects the latest send.
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoableId(newId);
    undoTimerRef.current = setTimeout(() => {
      setUndoableId((prev) => (prev === newId ? null : prev));
      undoTimerRef.current = null;
    }, 5000);
  }, [draftText]);

  // Per-message delete via the kebab menu. Always allowed — these are
  // local drafts on the customer's device with no recipient yet, so the
  // WhatsApp-style "can't unsend after the other side has seen it"
  // limit doesn't apply. The snackbar undo (5s) remains as a faster
  // path for the most recent send; the kebab covers everything else.
  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setOpenMenuId(null);
    setUndoableId((prev) => (prev === id ? null : prev));
    // If the user was editing this same bubble, cancel that too.
    setEditingId((prev) => (prev === id ? null : prev));
  }, []);

  // Edit flow: open the bubble's text into an inline textarea, save on
  // enter or Save button, cancel via Esc / Cancel button. Always
  // allowed for the same reason as delete — there's no recipient yet,
  // so there's nothing to "lock" once typed.
  const handleStartEdit = useCallback((id: string, currentText: string) => {
    setEditingId(id);
    setEditText(currentText);
    setOpenMenuId(null);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      // Empty edit = same as delete (matches WhatsApp behaviour: editing
      // to empty + save deletes the message).
      setMessages((prev) => prev.filter((m) => m.id !== editingId));
      setEditingId(null);
      setEditText("");
      return;
    }
    setMessages((prev) => prev.map((m) =>
      m.id === editingId
        ? { ...m, text: trimmed, editedAt: Date.now() }
        : m,
    ));
    setEditingId(null);
    setEditText("");
  }, [editingId, editText]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  // Snackbar "Undo" — yanks the most recent send and clears the timer.
  const handleUndoSend = useCallback(() => {
    if (!undoableId) return;
    setMessages((prev) => prev.filter((m) => m.id !== undoableId));
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndoableId(null);
  }, [undoableId]);

  // Close the kebab menu on outside-click; without this an opened menu
  // would persist after the user navigates with their pointer.
  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    // Use a microtask delay so the click that OPENED the menu doesn't
    // immediately close it again.
    const t = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", handler);
    };
  }, [openMenuId]);

  // Clean up the undo timer on unmount so it doesn't fire after teardown.
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  // Voice-to-text using the Web Speech API. Same shape as ChatComposer's
  // implementation but local to the stub since we don't import the full
  // composer here. (We could refactor to share, but the stub composer is
  // intentionally a thinner experience — no attachments, no mention of
  // file size caps — so duplicating ~30 lines is the cleaner trade.)
  const startTranscribe = useCallback(async () => {
    if (voiceMode !== "idle") return;
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceMsg("Voice-to-text isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    setVoiceMsg(null);

    // Permissions API first — when state is "denied", the browser will
    // not re-prompt from JS and we'd silently get a NotAllowedError
    // with no UI. Better to tell the user up-front that they need to
    // change it in site-settings.
    const permState = await queryMicPermission();
    if (permState === "denied") {
      setVoiceMsg("Microphone is blocked for this site. Click the lock / info icon at the very left of the address bar → Site settings → Microphone → Allow → reload the page.");
      return;
    }
    // Only call getUserMedia when state is "granted" or "prompt".
    // Stopping the stream right after is intentional — we just need the
    // grant on record so SpeechRecognition can reuse it.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") {
          setVoiceMsg("You dismissed the microphone prompt. Click the mic icon again and choose Allow when your browser asks.");
        } else if (e instanceof Error && e.name === "NotFoundError") {
          setVoiceMsg("No microphone detected. Check that one is plugged in and not being used by another app.");
        } else {
          setVoiceMsg("Couldn't access your microphone.");
        }
        return;
      }
    }
    const r = new Ctor();
    transcribeBaseRef.current = draftText;
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      const composed = [transcribeBaseRef.current, finalText, interim]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      setDraftText(composed);
    };
    r.onerror = (e: { error: string }) => {
      // Same actionable-error translation as the live ChatComposer —
      // shared helper keeps both surfaces in sync (e.g. "Microphone
      // access blocked. Click the lock icon…" instead of the raw
      // "not-allowed" identifier).
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setVoiceMsg(speechRecognitionErrorMessage(e.error));
      }
      setVoiceMode("idle");
    };
    r.onend = () => {
      setVoiceMode("idle");
      recognitionRef.current = null;
    };
    recognitionRef.current = r;
    setVoiceMode("transcribing");
    try { r.start(); } catch {
      setVoiceMsg("Voice recognition couldn't start — try again in a moment.");
      setVoiceMode("idle");
    }
  }, [voiceMode, draftText]);

  const stopTranscribe = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
  }, []);

  // ── Attachment picker (paperclip) ─────────────────────────────────
  // Opens the OS file picker. Files are validated client-side (mime
  // whitelist + 50 MB cap), then persisted to IndexedDB via
  // stubDraftAttachments. The auto-flush in the parent RoomClient
  // moves them into the real session when one goes live.
  const handlePickFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    // Clear the input so picking the same file twice in a row still fires onChange.
    e.target.value = "";
    setVoiceMsg(null);
    const v = validateStagedFiles(files, []);
    if (!v.ok) {
      setVoiceMsg(v.error);
      return;
    }
    try {
      const fresh: StubAttachmentMeta[] = [];
      for (const c of v.classified) {
        const meta = await stubAddAttachment(c.file);
        fresh.push(meta);
      }
      setStubAttachments((prev) => [...fresh, ...prev]);
    } catch (err) {
      setVoiceMsg(err instanceof Error ? err.message : "Couldn't stage the file.");
    }
  }, []);

  const handleRemoveAttachment = useCallback(async (id: string) => {
    setStubAttachments((prev) => prev.filter((a) => a.id !== id));
    try { await stubRemoveAttachment(id); } catch { /* swallow — UI already updated */ }
  }, []);

  // ── Voice recording (record button) ───────────────────────────────
  // MediaRecorder → Blob → IDB. Mirrors the real ChatComposer's
  // record flow (see app/_components/ChatComposer.tsx:335) but stages
  // to IDB instead of an immediate upload. Tap to start, tap again to
  // stop. The button shows a pulsing dot while recording.
  const startStubRecording = useCallback(async () => {
    if (recState !== "idle") return;
    if (typeof window === "undefined" || !("MediaRecorder" in window)) {
      setVoiceMsg("Voice recording isn't supported in this browser.");
      return;
    }
    setVoiceMsg(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setVoiceMsg("Microphone access blocked. Click the lock icon in your browser's address bar, allow microphone, then try again.");
      } else if (e instanceof Error && e.name === "NotFoundError") {
        setVoiceMsg("No microphone detected. Check that one is plugged in and not being used by another app.");
      } else {
        setVoiceMsg("Couldn't access your microphone.");
      }
      return;
    }
    recorderStreamRef.current = stream;

    // MediaRecorder MIME pick — Chrome/Firefox produce webm/opus,
    // Safari produces audio/mp4. Probe in priority order; let the
    // browser pick its default if neither hint is supported.
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    let mime: string | undefined;
    for (const c of candidates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((MediaRecorder as any).isTypeSupported?.(c)) { mime = c; break; }
    }
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

    recorderChunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(recorderChunksRef.current, { type: rec.mimeType || "audio/webm" });
      recorderChunksRef.current = [];
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
      setRecState("idle");
      // Save to IDB as a normal file. mimeToExt-style suffix derived
      // from the recorder's actual MIME so download names stay sensible.
      const t = rec.mimeType || "audio/webm";
      const ext = t.includes("webm") ? "webm" : t.includes("mp4") ? "m4a" : t.includes("ogg") ? "ogg" : "webm";
      const name = `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      try {
        const meta = await stubAddAttachment(file);
        setStubAttachments((prev) => [meta, ...prev]);
      } catch (err) {
        setVoiceMsg(err instanceof Error ? err.message : "Couldn't save the recording.");
      }
    };
    rec.onerror = () => {
      setVoiceMsg("Recording failed — try again.");
      setRecState("idle");
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
      recorderStreamRef.current = null;
      recorderRef.current = null;
    };
    recorderRef.current = rec;
    setRecState("recording");
    rec.start();
  }, [recState]);

  const stopStubRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r) { setRecState("idle"); return; }
    try { r.stop(); } catch { /* already stopping */ }
  }, []);

  // Tear-down on unmount so an abandoned mic stream doesn't keep listening.
  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l transition-[width] duration-200"
      style={{
        width: sidebarCollapsed ? 48 : "min(30%, 420px)",
        minWidth: sidebarCollapsed ? 48 : 280,
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {/* Header — engineer-chat style. Collapsed rail shows just the
          expand toggle so the customer can recover the panel. */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--border)" }}
      >
        {!sidebarCollapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
              style={{
                // Live sessions get a green-tinted avatar; otherwise the
                // muted surface-raised. Matches the "live now" subtitle
                // color so the header reads as one element.
                backgroundColor: isLiveish ? BRAND_GREEN_SOFT : "var(--surface-raised)",
                color: isLiveish ? BRAND_GREEN : "var(--text-muted)",
              }}
            >
              {/* Show the engineer's initial when we have a name + are
                  live-ish; otherwise the generic chat icon. */}
              {engineerName && (isLiveish || isEndedish)
                ? engineerName[0].toUpperCase()
                : <MessageSquare size={14} />}
            </div>
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--text)" }}
              >
                {headerTitle}
              </span>
              <span
                className="inline-flex items-center gap-1 truncate text-[10px]"
                style={{ color: isLiveish ? BRAND_GREEN : "var(--text-muted)" }}
              >
                {isLiveish && (
                  <span aria-hidden className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60" style={{ backgroundColor: BRAND_GREEN }} />
                    <span className="relative h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                  </span>
                )}
                {headerSubtitle}
              </span>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100",
            sidebarCollapsed && "mx-auto",
          )}
          style={{ color: "var(--text-muted)" }}
          aria-label={sidebarCollapsed ? "Expand chat panel" : "Collapse chat panel"}
          title={sidebarCollapsed ? "Expand" : "Collapse"}
        >
          {sidebarCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
        </button>
      </div>

      {!sidebarCollapsed && (
        <>
          {/* Conversation area — when messages exist, render the WhatsApp-
              style bubble list with scroll. Empty buffer falls back to the
              "waiting for engineer" hint so first-time users still know
              what's going on. The same dotted-overlay background is kept
              in both states so the panel reads as one consistent surface.

              The outer wrapper is `relative` so the undo-snackbar can
              pin to its viewport bottom (not the scrolled content). The
              inner div is the actual scroll viewport with overflow-y-auto
              + a ref for the auto-scroll-to-bottom effect above. */}
          <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto px-3 py-4"
            style={{
              backgroundColor: "var(--background)",
              backgroundImage:
                "radial-gradient(circle, color-mix(in srgb, var(--text) 4%, transparent) 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-3 text-center">
                <div
                  className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)",
                    color: "var(--text-muted)",
                  }}
                >
                  <Lock size={18} />
                </div>
                <p
                  className="max-w-[220px] text-[12px] leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  Drop in your thoughts here — your engineer sees them as
                  soon as the call connects.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 pb-2">
                {/* Sticky system note at the top reminds the user that
                    these messages haven't reached an engineer yet — they
                    flush once the call goes live. */}
                <div
                  className="mx-auto mb-1 rounded-full border px-2.5 py-1 text-[10px]"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                    color: "var(--text-muted)",
                  }}
                >
                  Waiting for engineer · drafts saved on this device
                </div>
                {/* Render with date separators between days. WhatsApp shows
                    a centred pill ("TODAY" / "YESTERDAY" / "16 May") any
                    time the day flips — we mirror that so a long-running
                    draft buffer reads cleanly across multiple sessions. */}
                {messages.map((m, idx) => {
                  const prev = idx > 0 ? messages[idx - 1] : null;
                  const showSeparator = !prev || !sameDay(prev.createdAt, m.createdAt);
                  return (
                    <div key={m.id}>
                      {showSeparator && <DateSeparatorPill ts={m.createdAt} />}
                      <DraftBubble
                        message={m}
                        menuOpen={openMenuId === m.id}
                        editing={editingId === m.id}
                        editText={editText}
                        onEditTextChange={setEditText}
                        onOpenMenu={() => setOpenMenuId(m.id)}
                        onCloseMenu={() => setOpenMenuId(null)}
                        onStartEdit={() => handleStartEdit(m.id, m.text)}
                        onSaveEdit={handleSaveEdit}
                        onCancelEdit={handleCancelEdit}
                        onDelete={() => handleDeleteMessage(m.id)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Undo snackbar — WhatsApp/Gmail-style. Floats above the
              composer for 5 seconds after a send, pinned to the
              VIEWPORT bottom of the scroll area (not the scrolled
              content) by living outside the scroll div. Auto-dismisses
              after the timer; after that the bubble can still be
              deleted via its kebab menu — undo just becomes implicit. */}
          {undoableId && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4"
              style={{ animation: "relay-toast-in 200ms ease-out" }}
            >
              <div
                className="pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-2"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface)",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                }}
              >
                <Check size={12} style={{ color: BRAND_GREEN }} />
                <span className="text-[12px]" style={{ color: "var(--text)" }}>
                  Message sent
                </span>
                <button
                  type="button"
                  onClick={handleUndoSend}
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ color: BRAND_GREEN }}
                >
                  Undo
                </button>
              </div>
            </div>
          )}
          </div>

          {/* Composer — large card-style block matching the reference:
              multi-line textarea on top, action row underneath with
              paperclip (attach), mic (voice → text or voice message),
              and a labelled Send pill on the right.
              Fully disabled in this placeholder state — wakes up when
              a live engineer is on a call. */}
          <div
            className="shrink-0 border-t px-3 py-5"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
          >
            {voiceMsg && (
              <div
                className="mb-2 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[11px]"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface-raised)",
                  color: "var(--text-muted)",
                }}
              >
                <span>{voiceMsg}</span>
                <button
                  type="button"
                  onClick={() => setVoiceMsg(null)}
                  className="opacity-60 transition-opacity hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X size={11} />
                </button>
              </div>
            )}
            <div
              className="rounded-2xl border p-5"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-raised)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <textarea
                rows={14}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  // Plain Enter sends — matches the live ChatComposer
                  // (app/_components/ChatComposer.tsx) so users build
                  // the same muscle memory in both surfaces.
                  // Shift+Enter inserts a newline for multi-paragraph
                  // drafts. IME composition (Asian languages) gets a
                  // pass — committing a character via Enter shouldn't
                  // accidentally fire the send.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSendDraft();
                  }
                }}
                placeholder="Message your engineer…"
                className="block w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:opacity-60"
                style={{ color: "var(--text)" }}
              />

              {/* Pending-attachments tray — files + voice recordings staged
                  via the paperclip / record buttons. Sits between the
                  textarea and the button row so it's clearly part of
                  the same draft. Each chip has a remove-X. The whole
                  block disappears when the queue empties. Per-row icon
                  is keyed off the chatAttachments kind classification
                  (image/document/audio). */}
              {stubAttachments.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    Will be delivered when your engineer joins
                  </div>
                  <ul className="flex flex-col gap-1">
                    {stubAttachments.map((a) => {
                      const Icon = a.kind === "audio" ? Music : a.kind === "image" ? FileText : FileText;
                      return (
                        <li
                          key={a.id}
                          className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11.5px]"
                          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                        >
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                          >
                            <Icon size={11} />
                          </span>
                          <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{a.name}</span>
                          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {a.size < 1024 * 1024 ? `${Math.round(a.size / 1024)} KB` : `${(a.size / (1024 * 1024)).toFixed(1)} MB`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveAttachment(a.id)}
                            aria-label={`Remove ${a.name}`}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <X size={11} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* voiceMsg renders ONCE in the pre-existing toast above
                  the composer (see ~3191 — dismissable, sits above the
                  textarea). We don't re-render it here. The record-state
                  pulse below is a transient "currently recording" tell
                  that's separate from error state. */}
              {recState === "recording" && (
                <p className="mt-2 inline-flex items-center gap-1 text-[11px]" style={{ color: BRAND_GREEN }}>
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60" style={{ backgroundColor: BRAND_GREEN }} />
                    <span className="relative h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                  </span>
                  Recording — tap mic again to finish.
                </p>
              )}
              <div className="mt-2 flex items-center gap-1">
                {/* Paperclip — picks files into the IDB-backed staging
                    queue. They sit there until a session goes live; the
                    parent's auto-flush effect (flushAttachmentsToSession)
                    handles the upload + guest_message_attachments insert
                    once a guest_calls row exists. */}
                <input
                  ref={attachInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.txt,.xlsx,.docx,image/*,audio/*"
                  onChange={(e) => void handlePickFiles(e)}
                />
                <button
                  type="button"
                  onClick={() => attachInputRef.current?.click()}
                  aria-label="Attach file"
                  title="Attach a file — it'll be delivered when your engineer joins."
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Paperclip size={14} />
                </button>
                {/* Voice-to-text dictation — works locally without a
                    session (Web Speech API in-browser), so this DOES
                    function in the stub. Click to start/stop. */}
                <button
                  type="button"
                  onClick={voiceMode === "transcribing" ? stopTranscribe : () => void startTranscribe()}
                  aria-label="Dictate"
                  title={voiceMode === "transcribing" ? "Stop dictating" : "Dictate — voice to text"}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{
                    color: voiceMode === "transcribing" ? BRAND_GREEN : "var(--text-muted)",
                    backgroundColor: voiceMode === "transcribing"
                      ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                      : "transparent",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Mic size={14} />
                </button>
                {/* Voice-recording — MediaRecorder writes the blob to
                    IDB. Same flush path as paperclip-staged files. */}
                <button
                  type="button"
                  onClick={recState === "recording" ? stopStubRecording : () => void startStubRecording()}
                  aria-label={recState === "recording" ? "Stop recording" : "Record voice message"}
                  title={recState === "recording"
                    ? "Tap to finish recording"
                    : "Record a voice message — it'll be delivered when your engineer joins."}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{
                    color: recState === "recording" ? "#fff" : "var(--text-muted)",
                    backgroundColor: recState === "recording" ? BRAND_GREEN : "transparent",
                    border: "1px solid var(--border)",
                  }}
                >
                  <AudioLines size={14} className={recState === "recording" ? "animate-pulse" : undefined} />
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleSendDraft}
                  disabled={!draftText.trim()}
                  aria-label="Send"
                  className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: BRAND_GREEN,
                    color: "#fff",
                  }}
                >
                  <Send size={12} />
                  Send
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

// Just-ended live session — same shape as PastSessionReview but with the
// session + messages already in memory (no fetch needed). Centre summary
// (70%) + inactive WhatsApp chat stub (30%). Kept as a thin wrapper so the
// MainPane switch reads naturally.
function EndedSessionReview({
  session,
  messages,
  currentUserId,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  currentUserId: string | null;
}) {
  const [chatCollapsed, setChatCollapsed] = useState(false);
  return (
    <div className="flex h-full w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <SummaryPanel session={session} messages={messages} currentUserId={currentUserId} />
      </div>
      <ChatPanelStub
        sidebarCollapsed={chatCollapsed}
        onToggleCollapsed={() => setChatCollapsed((v) => !v)}
        session={session}
      />
    </div>
  );
}

// Past session view — split layout owned by this component:
//   • Center (70%) → AI summary (title, overview, next steps, zoom call
//                    summaries). The summary IS the session's read-out;
//                    the raw event timeline is redundant once we have
//                    the AI rollup, so we don't surface it separately.
//   • Right (30%)  → WhatsApp-style chat panel. Inactive until a live
//                    engineer is on a call — for past sessions there's
//                    no active call, so it sits as the same placeholder
//                    the landing shows. Keeps the visual register
//                    consistent across "no session" and "past session"
//                    states so the customer always knows where chat
//                    lives.
function PastSessionReview({
  sessionId,
  onClose,
  currentUserId,
}: {
  sessionId: string;
  onClose: () => void;
  currentUserId: string | null;
}) {
  const [row, setRow] = useState<GuestCall | null>(null);
  const [msgs, setMsgs] = useState<GuestMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);

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
    <div className="flex h-full w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <SummaryPanel session={row} messages={msgs} onClose={onClose} currentUserId={currentUserId} />
      </div>
      <ChatPanelStub
        sidebarCollapsed={chatCollapsed}
        onToggleCollapsed={() => setChatCollapsed((v) => !v)}
        session={row}
      />
    </div>
  );
}

// Read-only chat pane — used to render the past-session timeline on the
// left of PastSessionReview. Currently NOT mounted in any render path
// (the post-session review surfaces the AI summary 70% + inactive
// WhatsApp chat stub 30% instead). Kept here in case we want to bring
// back an inline event timeline as an opt-in tab later.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ReadOnlyChatPane({
  messages,
  session,
}: {
  messages: GuestMessage[];
  session: GuestCall;
}) {

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

    </section>
  );
}

// Summary-only sidebar for past + just-ended sessions. Replaces the older
// ReviewPanel that tabbed between Summary and Chat history — chat history
// now lives in the main chat pane, so the sidebar focuses on the AI summary.
function SummaryPanel({
  session,
  messages,
  onClose,
  currentUserId,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  onClose?: () => void;
  /** Forwarded into SummaryView for canEdit gating. */
  currentUserId: string | null;
}) {
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
      <SummaryView session={session} messages={messages} currentUserId={currentUserId} />
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
  session, entitlement, accepted, onEnd, onJoin,
}: {
  session: GuestCall | null;
  entitlement: { free_consumed_at: string | null; paid_minutes_remaining: number };
  accepted: boolean;
  onEnd: (reason?: string) => Promise<void>;
  /** Same action as the in-chat "Join Zoom call" button — stamps joined + opens Zoom. */
  onJoin?: () => void | Promise<void>;
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
            <CallHeaderActions session={session} onJoin={onJoin} />
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
function CallHeaderActions({ session, onJoin }: { session: GuestCall; onJoin?: () => void | Promise<void> }) {
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
          // Header call button now does the SAME thing as the in-chat
          // "Join Zoom call" button: stamp joined + open the Zoom URL.
          if (!canJoin || !session.zoom_join_url) return;
          void onJoin?.();
          window.open(session.zoom_join_url, "_blank", "noopener,noreferrer");
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
  /** Display name with date+time appended (e.g., "Stripe webhook · May 26, 1:23 AM").
   *  Used in project-grouped view where the surrounding folder gives
   *  the project context so the date stamp helps disambiguate same-day
   *  sessions. */
  title: string;
  /** Just the topic — no date. Used in flat-session view where the
   *  meta line carries the date separately. Falls back to project name
   *  or "Session" when no AI summary / intake / first message exists. */
  topic: string;
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
  /** Lifecycle. "completed" starts the 90-day retention clock; "archived"
   *  is post-sweep. v1 only surfaces "Mark complete" as a customer action;
   *  archived is set by the purge edge function. */
  completionStatus: "active" | "completed" | "archived";
  completedAt: string | null;
};

type ProjectGroup = {
  key: string;           // projectId or "general"
  name: string;          // display name
  sessions: PastSession[];
  latestDate: number;    // ms timestamp — used for sorting
  completionStatus: "active" | "completed" | "archived";
};

const Sidebar = memo(function Sidebar({
  email, customerUserId, session, entitlement, employment, viewingPastId, projects,
  selectedProjectId, onViewPast, onNewSession, onNewChat, onStartInProject, onRenameProject, onStartNewProject, onCreateProjectWithMetadata, onSelectProject, onWalletClick, onOpenProfile, onOpenBilling, onOpenLegal, onGoHome, onPrepareSession, draftsTick, onDeleteProject, onMarkProjectComplete, onPickerToast,
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
  /** Connect-flow new-project submit. Creates project with the chosen name
   *  + persists stack/project-type into the intake, then starts a session
   *  bound to it. End-to-end: form submit → project + intake + ring. */
  onStartNewProject: (opts: {
    name: string;
    projectType: string;
    aiTools: string[];
    backend: string[];
    frontend: string[];
  }) => Promise<void>;
  /** "+ Create New Project" submit. Creates the project + writes its
   *  metadata, but does NOT start a session. The customer rings the
   *  engineer separately via the phone button on the project row or
   *  the top-of-sidebar Connect button. */
  onCreateProjectWithMetadata: (opts: {
    name: string;
    projectType: string;
    aiTools: string[];
    backend: string[];
    frontend: string[];
  }) => Promise<void>;
  /** Click on a project header — toggle that project as the current
   *  context for the no-session landing. Same id toggles off. */
  onSelectProject: (projectId: string | null) => void;
  onWalletClick: () => void;
  /** Open the in-pane Account view on the Profile tab. Used by the
   *  user menu's "Profile & settings" entry. */
  onOpenProfile: () => void;
  /** Open the in-pane Account view directly on the Billing tab.
   *  Quick shortcut from the user-menu list — saves the customer a
   *  click from "Profile & settings → Billing". */
  onOpenBilling: () => void;
  /** Open the in-pane legal viewer for Privacy or Terms. Triggered
   *  from the user menu's Learn more section. */
  onOpenLegal: (kind: LegalKind) => void;
  /** Return to the BrandedLanding from any side-track view. Clears
   *  account / legal / past-session / project-picker selection. */
  onGoHome: () => void;
  /** Open the central "Prepare a session" pane for a given project so
   *  the customer can draft text / drop files / record voice before
   *  ringing the engineer. Fired from the + button on each project
   *  header in the accordion, and from clicks on saved draft rows
   *  (in which case the second arg points at an existing draft id). */
  onPrepareSession: (projectId: string, draftId?: string | null) => void;
  /** Incremented every time the drafts list changes (save / delete /
   *  promote). The ProjectAccordion uses this to invalidate its
   *  localStorage read so newly-saved drafts appear immediately
   *  without a route change. */
  draftsTick: number;
  /** Open the 2-factor delete-project confirmation modal at the
   *  RoomClient level. */
  onDeleteProject: (projectId: string, projectName: string) => void;
  /** Flip the project to 'completed' which starts the 90-day retention
   *  clock for chat-attachment purge. */
  onMarkProjectComplete: (projectId: string, projectName: string) => void;
  /** Surface a transient toast (5s auto-dismiss) from inside the
   *  engineer picker. RoomClient owns the toast state; Sidebar can't
   *  reach it directly, so it gets fired through this callback prop. */
  onPickerToast: (message: string) => void;
}) {
  // Sidebar starts EXPANDED by default (Order 1 of the Commander brief —
  // Projects expanded, every action labelled, no mystery icons). User can
  // still collapse for the visit. Persistence intentionally NOT kept so
  // returning users see the full hierarchy on each fresh /room landing.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const toggleCollapsed = (next: boolean) => setCollapsed(next);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Quote-request flow: null = closed; "golive" = ship-it lead;
  // "maintain" = ongoing maintenance/enhancement lead. Both kinds use
  // the same QuoteRequestModal component, distinguished by the prop.
  const [quoteFlow, setQuoteFlow] = useState<"golive" | "maintain" | null>(null);
  const [past, setPast] = useState<PastSession[]>([]);
  // Global search — filters both project names and session titles/agents.
  const [searchQuery, setSearchQuery] = useState("");

  // Filter + sort state for the new sidebar controls.
  //   statusFilter — defaults to "all" so a fresh customer sees their
  //     full history. "active" narrows to live + recent; "ended" is a
  //     focused historical view.
  //   groupBy — "project" is the default: customers think in projects
  //     first, sessions second. The accordion view shows the project
  //     list with sessions tucked away under each header; expanding a
  //     project reveals its sessions for drill-down. "date" flattens
  //     into a single time-sorted feed across projects.
  //   pinnedIds — session ids the user has pinned. Persisted to
  //     localStorage so the choice survives reloads; promoting to Supabase
  //     is a follow-up that needs a guest_calls.pinned_at column.
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "completed">("all");
  const [groupBy, setGroupBy] = useState<"project" | "date">("project");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "title">("recent");
  // Sort/filter popover open state — single boolean. Click the SlidersHorizontal
  // button to toggle; click outside or the X to close.
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  // Which row inside the popover is currently expanded (showing its
  // submenu of options). Only one row can be expanded at a time so the
  // panel doesn't balloon vertically.
  const [expandedSortRow, setExpandedSortRow] = useState<
    null | "status" | "groupBy" | "sortBy"
  >(null);
  const sortPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sortPanelOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!sortPanelRef.current?.contains(e.target as Node)) {
        setSortPanelOpen(false);
        setExpandedSortRow(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Esc collapses the inner submenu first, then the whole panel.
        if (expandedSortRow !== null) setExpandedSortRow(null);
        else setSortPanelOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortPanelOpen, expandedSortRow]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = window.localStorage.getItem("relay_pinned_session_ids");
      return new Set<string>(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "relay_pinned_session_ids",
        JSON.stringify([...pinnedIds]),
      );
    } catch {
      /* localStorage unavailable (private window, quota, etc.) — silent */
    }
  }, [pinnedIds]);
  const togglePin = useCallback((sessionId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  // Engineer presence is now read live per-engineer inside the ConnectFlow
  // picker — each row queries engineer_profiles.presence_state via display
  // alias and renders the right Online / Busy / Offline badge accordingly.
  // (The matcher itself still gates on engineer_profiles.is_available.)

  // Connect-flow modal state. null = closed.
  //   "choose"          — new vs existing
  //   "existing"        — pick from existing projects (→ "engineerPicker")
  //   "engineerPicker"  — choose which engineer to connect with for the picked project
  //   "details"         — compact form: project type + stack (new project)
  //   "name"            — pick a name; submit creates project + (optionally) starts session
  const [connectFlow, setConnectFlow] = useState<
    null | "choose" | "existing" | "engineerPicker" | "details" | "name"
  >(null);
  // The project the user picked in step "existing" (or that came from a
  // per-project phone button shortcut). Drives what the "engineerPicker"
  // step shows.
  const [pickerProjectId, setPickerProjectId] = useState<string | null>(null);
  // Schedule-engineer modal target. When set, the modal mounts and shows
  // open 30-min slots for the engineer; null = closed. Driven by the
  // "Schedule" button on Offline engineers in the picker.
  const [scheduleTarget, setScheduleTarget] = useState<
    null | { engineerUserId: string; engineerName: string; projectId: string | null }
  >(null);
  // Mode toggle for the form steps. "connect" (default) = submit creates
  // project + rings engineer. "create-only" = submit only creates the
  // project (called from the "+ Create New Project" button). The form
  // UI is identical; only the submit handler + button label differ.
  const [connectFlowMode, setConnectFlowMode] = useState<"connect" | "create-only">("connect");
  // Form state for the new-project flow. Lives at the Sidebar level so it
  // survives back/forward navigation between the "details" and "name" steps.
  const [newProjectType, setNewProjectType] = useState<string>("");
  const [newProjectTypeOther, setNewProjectTypeOther] = useState<string>("");
  const [newProjectAiTools, setNewProjectAiTools] = useState<string[]>([]);
  const [newProjectBackend, setNewProjectBackend] = useState<string[]>([]);
  const [newProjectFrontend, setNewProjectFrontend] = useState<string[]>([]);
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [newProjectSubmitting, setNewProjectSubmitting] = useState(false);
  const resetNewProjectForm = () => {
    setNewProjectType("");
    setNewProjectTypeOther("");
    setNewProjectAiTools([]);
    setNewProjectBackend([]);
    setNewProjectFrontend([]);
    setNewProjectName("");
    setNewProjectSubmitting(false);
  };

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
        // Session names are formatted as `{topic} · {date}, {time}` so a
        // datestamp + timestamp always anchors the name and same-day
        // sessions are distinguishable in the sidebar. Topic priority
        // falls through ai_summary_title → intake_summary → first user
        // message → project name → generic "Session". Date format is
        // short month + day ("May 26"), time is locale-formatted h:mm
        // with am/pm ("3:42 PM").
        const topic =
          aiTitle ||
          cleanLead(intakeHeadline) ||
          cleanLead(firstMsgRaw) ||
          (projectNameRaw && projectNameRaw !== "Project"
            ? projectNameRaw
            : "Session");
        const autoName = `${topic} · ${friendlyDate}, ${friendlyTime}`;
        return {
          id:          row.id as string,
          title:       autoName,
          topic,
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
  //
  // Filters applied in order: status filter (drops sessions outside the
  // chosen status bucket), search query (substring match across title /
  // agent / project name / status), then pin-aware sort (pinned sessions
  // float to the top of each group, then date-desc).
  //
  // NB: statusFilter applies at the PROJECT level (Active = not completed,
  // Completed = completed/archived). It does NOT filter individual
  // sessions, so a completed project's session history is preserved
  // even when "Active" is selected. See the post-filter step below.
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
        completionStatus: p.completionStatus,
      });
    }
    // "General" bucket for sessions with no project.
    const general: ProjectGroup = { key: "general", name: "General", sessions: [], latestDate: 0, completionStatus: "active" };

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
                    completionStatus: "active",
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

    // Pin-aware session sort — pinned to the top of each group, then
    // applying the user's chosen sortBy (recent / oldest / title) within
    // each pin tier. Pinned-state always wins over sort order so a pinned
    // ancient session still floats to the top.
    const sortSessions = (sessions: PastSession[]) =>
      [...sessions].sort((a, b) => {
        const aPin = pinnedIds.has(a.id) ? 1 : 0;
        const bPin = pinnedIds.has(b.id) ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        if (sortBy === "title") return a.title.localeCompare(b.title);
        const aT = new Date(a.date).getTime();
        const bT = new Date(b.date).getTime();
        return sortBy === "oldest" ? aT - bT : bT - aT;
      });

    // Apply status + search filters. Status filter applies unconditionally;
    // search filter only when there's a query.
    const groups = Array.from(map.values()).map((g) => {
      const nameHit = matchProjectName(g.name);
      const sessions = sortSessions(g.sessions.filter(matchSession));
      if (!q) {
        // No search — keep the project but with status-filtered sessions.
        return { ...g, sessions };
      }
      if (nameHit && sessions.length === 0 && g.sessions.length === 0) return { ...g, sessions };
      if (sessions.length > 0) return { ...g, sessions };
      if (nameHit) return { ...g, sessions: sortSessions(g.sessions) }; // name hit, show all (filtered) sessions
      return null;
    }).filter((g): g is ProjectGroup => g !== null);

    // Suppress ALL "Try Relay" projects from the sidebar (regardless of
    // session count). The marketing-site Try Relay funnel auto-creates
    // these on guest entry, but they're not part of the customer's
    // real workflow — which is: create project with metadata → ring
    // engineer. Any Try-Relay projects from the funnel are legacy noise.
    // The underlying Supabase rows are untouched; this is a display-
    // only filter so the data hygiene side stays user-controlled.
    const cleaned = groups.filter((g) => {
      const name = g.name.trim().toLowerCase();
      return name !== "try relay" && name !== "try-relay";
    });

    // ── Project-level status filter ──────────────────────────────────
    // Applied AFTER session-level search filter so a search hit in a
    // completed project still surfaces when "All" is selected. The
    // "general" bucket (sessions with no project) has no completion
    // status — show it in Active but not in Completed.
    const statusFiltered = cleaned.filter((g) => {
      if (statusFilter === "all") return true;
      if (g.key === "general") return statusFilter === "active";
      if (statusFilter === "active") {
        return g.completionStatus !== "completed" && g.completionStatus !== "archived";
      }
      // statusFilter === "completed"
      return g.completionStatus === "completed" || g.completionStatus === "archived";
    });

    return statusFiltered.sort((a, b) => b.latestDate - a.latestDate);
  }, [projects, past, searchQuery, statusFilter, pinnedIds, sortBy]);

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
          className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelLeftOpen size={18} />
        </button>

        {/* Home — same affordance as the expanded sidebar so the
            customer can always return to the landing surface without
            having to expand the sidebar first. */}
        <button
          onClick={onGoHome}
          title="Home"
          aria-label="Home"
          className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <Home size={16} />
        </button>

        {/* "+ New session" button removed — the new "Get your engineer"
            widget lives only in the expanded sidebar. Users on collapsed
            mode click the expand toggle above to reveal it. */}

        {/* Search — expanding the rail makes the input focusable */}
        <button
          onClick={() => toggleCollapsed(false)}
          title="Search sessions"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <Search size={16} />
        </button>

        {/* Sessions */}
        <button
          title="Sessions"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
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
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
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
              onOpenProfile={() => { setUserMenuOpen(false); onOpenProfile(); }}
              onOpenBilling={() => { setUserMenuOpen(false); onOpenBilling(); }}
              onOpenLegal={(kind) => { setUserMenuOpen(false); onOpenLegal(kind); }}
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
      {/* Brand row — wordmark (clickable, returns home) + theme
          triplet + explicit Home icon + flex spacer + collapse toggle.
          Two ways to go home so the affordance is unambiguous: the
          logo follows the universal "click logo to return to landing"
          convention, and the explicit Home icon is for users who
          don't intuit that the wordmark is interactive. */}
      <div className="flex h-12 items-center gap-2 px-3">
        <button
          type="button"
          onClick={onGoHome}
          title="Return to the home landing"
          aria-label="Home"
          className="rounded-md transition-opacity hover:opacity-80"
        >
          <Wordmark size="md" />
        </button>
        <ThemeTriplet />
        <button
          type="button"
          onClick={onGoHome}
          title="Home"
          aria-label="Home"
          className="flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <Home size={15} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => toggleCollapsed(true)}
          title="Collapse sidebar"
          className="flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 ease-out hover:scale-110 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5"
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

      {/* "Connect to Relay Engineer" — the top entry point into the
          connect flow. A circular brand-green ball with the call-to-
          action text centered inside. Heartbeat animation on the ball
          + a pulsing green aura behind it (lub-dub rhythm via the
          rk-connect-* keyframes defined in <style jsx> below). The aura
          is its own absolute element sized 1.4× the ball — z-index
          ordering keeps it BEHIND the button.

          Because the customer can have multiple projects with different
          engineers per project, this top button is intentionally
          engineer-agnostic — clicking it always opens the New-vs-Existing
          chooser. */}
      <div className="flex flex-col gap-2 px-2 py-1">
        <div className="relative flex flex-col items-center gap-2 py-2">
        {/* Pulsing aura — sits behind the ball, scaled larger via inset
            negative + opacity-pulses with the heartbeat rhythm. Color
            derived from var(--primary) via color-mix so the aura
            matches whichever brand-green the active theme resolves to
            (was hardcoded rgba(77,200,109) — a muted forest green
            that didn't match the platform palette). */}
        <span
          aria-hidden="true"
          className="rk-connect-aura pointer-events-none absolute"
          style={{
            top: 8,
            width: 140,
            height: 140,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, " +
              "color-mix(in srgb, var(--primary) 55%, transparent) 0%, " +
              "color-mix(in srgb, var(--primary) 22%, transparent) 32%, " +
              "color-mix(in srgb, var(--primary) 0%, transparent) 65%)",
            filter: "blur(8px)",
            zIndex: 0,
          }}
        />
        <button
          type="button"
          onClick={() => setConnectFlow("choose")}
          aria-label="Connect to a Relay engineer"
          className="rk-connect-ball relative flex h-[140px] w-[140px] flex-col items-center justify-center rounded-full text-center transition-transform hover:scale-[1.03] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4"
          style={{
            // Ball gradient now keyed off var(--primary) — same green
            // family as every other brand element on the page. Was the
            // muted #4d6b40/#3f5c34 forest pair which read as a
            // separate, dated color. The two overlay highlight/shadow
            // gradients stay the same to keep the 3D-button look.
            background:
              "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0) 38%), " +
              "radial-gradient(circle at 70% 75%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0) 55%), " +
              "radial-gradient(circle at 50% 50%, " +
              "var(--primary) 30%, " +
              "color-mix(in srgb, var(--primary) 70%, #000) 100%)",
            boxShadow:
              "0 18px 32px color-mix(in srgb, var(--primary) 32%, transparent), " +
              "0 6px 12px color-mix(in srgb, var(--primary) 22%, transparent), " +
              "inset 0 -8px 14px rgba(0, 0, 0, 0.22), " +
              "inset 0 8px 14px rgba(255, 255, 255, 0.12)",
            zIndex: 1,
          }}
        >
          <Phone size={20} style={{ color: "#fff", opacity: 0.9, marginBottom: 6 }} />
          <span
            className="px-3 text-[13px] font-semibold leading-tight"
            style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}
          >
            Connect to
            <br />
            Relay Engineer
          </span>
        </button>
        {/* Scoped keyframes for the heartbeat + aura. lub-dub rhythm: two
            beats per 1.6s cycle (14% peak, 28% relax, 42% bigger peak,
            then long rest). Aura scales + opacity in lockstep; ball does
            a more subtle scale to avoid fighting the hover/active
            transforms. Respects prefers-reduced-motion. */}
        <style jsx>{`
          .rk-connect-aura {
            animation: rk-connect-aura 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            transform-origin: center;
          }
          .rk-connect-ball {
            animation: rk-connect-ball 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            transform-origin: center;
          }
          .rk-connect-ball:hover,
          .rk-connect-ball:active {
            animation-play-state: paused;
          }
          @keyframes rk-connect-aura {
            0%   { transform: scale(1);    opacity: 0.45; }
            14%  { transform: scale(1.12); opacity: 0.85; }
            28%  { transform: scale(1.04); opacity: 0.55; }
            42%  { transform: scale(1.22); opacity: 0.95; }
            70%, 100% { transform: scale(1); opacity: 0.45; }
          }
          @keyframes rk-connect-ball {
            0%, 70%, 100% { transform: scale(1); }
            14%           { transform: scale(1.04); }
            42%           { transform: scale(1.06); }
          }
          @media (prefers-reduced-motion: reduce) {
            .rk-connect-aura,
            .rk-connect-ball {
              animation: none;
            }
            .rk-connect-aura {
              opacity: 0.6;
              transform: scale(1.05);
            }
          }
        `}</style>
        <p
          className="text-center text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {past.some((s) => !!s.agent)
            ? "Pick a project to see your engineers"
            : "Your first engineer pairs on this call"}
        </p>
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
            placeholder="Search sessions and projects"
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

      {/* Projects (each is a folder containing sessions). The "+ Create
          New Project" button below opens the same compact form as the
          connect-flow new-project path, but in "create-only" mode — it
          stores name + project type + stack metadata against the new
          project WITHOUT starting an engineer session. Customer rings
          separately via the per-project phone button or the top
          Connect button, both of which use the per-project metadata
          to drive engineer skill matching. */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-3">
        <div className="mb-1 px-2.5 py-1">
          <button
            onClick={() => {
              setConnectFlowMode("create-only");
              setConnectFlow("details");
            }}
            title="Create a project with name + stack metadata (no engineer call yet)"
            aria-label="Create a project with name and stack metadata"
            className="group/cta inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-[var(--surface-raised)]"
            style={{ color: "var(--primary-hover)" }}
          >
            <Plus size={12} className="transition-transform duration-150 ease-out group-hover/cta:rotate-90" />
            Create New Project
          </button>
        </div>

        {/* Pinned section — sessions the customer is actively working
            on. Always renders the header in the same color register as
            "Create New Project" (var(--primary-hover)) so it reads as
            part of the same "things you reach for" cluster. Sessions
            pin/unpin via the existing Pin icon on each row (kebab
            inside SessionRowFlat + ProjectAccordion). Hidden when no
            pins exist so we don't show an empty header. */}
        {(() => {
          const pinnedSessions = past
            .filter((s) => pinnedIds.has(s.id))
            // Preserve pin-insertion order via the Set iteration
            // order so a freshly-pinned session bubbles to the top.
            .sort((a, b) => {
              const ids = [...pinnedIds];
              return ids.indexOf(a.id) - ids.indexOf(b.id);
            });
          if (pinnedSessions.length === 0) return null;
          return (
            <div className="mb-1 px-2.5">
              <div
                className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--primary-hover)" }}
              >
                Pinned
              </div>
              <div className="flex flex-col gap-0.5">
                {pinnedSessions.map((s) => (
                  <SessionRowFlat
                    key={s.id}
                    session={s}
                    isPinned
                    isViewing={viewingPastId === s.id}
                    isCurrent={
                      !!session
                      && s.id === session.id
                      && !["ended", "cancelled", "abandoned"].includes(s.status)
                    }
                    onClick={() => onViewPast(s.id)}
                    onTogglePin={() => togglePin(s.id)}
                    showProjectName
                  />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Separator between the create-project action and the filter
            popover + project list. */}
        <div
          className="mx-2.5 my-1.5 h-px"
          style={{ backgroundColor: "var(--border)" }}
          aria-hidden="true"
        />

        {/* Sort/filter popover — modeled on the Claude reference. A single
            SlidersHorizontal icon button opens an inline panel with three
            rows (Status / Group by / Sort by). Each row shows label on the
            left, current value on the right, with a chevron-right that
            cycles the value on click. Click outside or Escape to close. */}
        <div ref={sortPanelRef} className="relative mb-1.5 px-2.5">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: "var(--text-muted)" }}
            >
              {statusFilter === "all" ? "All sessions" : statusFilter === "active" ? "Active" : "Completed"}
              {" · "}
              {groupBy === "project" ? "by project" : "by date"}
            </span>
            <button
              type="button"
              onClick={() => setSortPanelOpen((v) => !v)}
              title="Filter and sort"
              aria-label="Filter and sort"
              aria-expanded={sortPanelOpen}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                sortPanelOpen
                  ? "bg-[var(--surface-raised)]"
                  : "hover:bg-[var(--surface-raised)]",
              )}
              style={{ color: "var(--text-muted)" }}
            >
              <SlidersHorizontal size={13} />
            </button>
          </div>

          {sortPanelOpen && (
            <div
              className="absolute right-2 top-7 z-30 w-[228px] rounded-lg border shadow-xl"
              style={{
                backgroundColor: "var(--surface)",
                borderColor: "var(--border)",
              }}
            >
              <SortRow
                label="Status"
                value={
                  statusFilter === "all" ? "All" : statusFilter === "active" ? "Active" : "Completed"
                }
                highlight={statusFilter !== "all"}
                options={[
                  { value: "all",       label: "All" },
                  { value: "active",    label: "Active" },
                  { value: "completed", label: "Completed" },
                ]}
                expanded={expandedSortRow === "status"}
                onToggle={() =>
                  setExpandedSortRow((v) => (v === "status" ? null : "status"))
                }
                onSelect={(v) => {
                  setStatusFilter(v as "all" | "active" | "completed");
                  setExpandedSortRow(null);
                }}
              />
              <SortRow
                label="Group by"
                value={groupBy === "project" ? "Project" : "Date"}
                highlight={groupBy !== "project"}
                options={[
                  { value: "project", label: "Project" },
                  { value: "date",    label: "Date" },
                ]}
                expanded={expandedSortRow === "groupBy"}
                onToggle={() =>
                  setExpandedSortRow((v) => (v === "groupBy" ? null : "groupBy"))
                }
                onSelect={(v) => {
                  setGroupBy(v as "project" | "date");
                  setExpandedSortRow(null);
                }}
              />
              <SortRow
                label="Sort by"
                value={
                  sortBy === "recent" ? "Recent" : sortBy === "oldest" ? "Oldest" : "Title"
                }
                highlight={sortBy !== "recent"}
                options={[
                  { value: "recent", label: "Recent" },
                  { value: "oldest", label: "Oldest" },
                  { value: "title",  label: "Title (A→Z)" },
                ]}
                expanded={expandedSortRow === "sortBy"}
                onToggle={() =>
                  setExpandedSortRow((v) => (v === "sortBy" ? null : "sortBy"))
                }
                onSelect={(v) => {
                  setSortBy(v as "recent" | "oldest" | "title");
                  setExpandedSortRow(null);
                }}
                last
              />
            </div>
          )}
        </div>

        {(() => {
          // ONLY "Group by: Date" flips the sidebar from project
          // accordions to a flat session list. Status filter operates
          // at the project level (Active = projects not completed,
          // Completed = projects marked completed/archived) and keeps
          // the accordion view. Sort order applies in either view.
          const isSessionView = groupBy === "date";

          if (!isSessionView) {
            // Default view — project accordions (unchanged behavior).
            return projectGroups.length > 0
              ? projectGroups.map((group) => (
                  <ProjectAccordion
                    key={group.key}
                    group={group}
                    viewingPastId={viewingPastId}
                    currentSessionId={session?.id ?? null}
                    selectedProjectId={selectedProjectId}
                    onViewPast={onViewPast}
                    onStartInProject={(projectId) => {
                      if (projectId === null) {
                        onStartInProject(null);
                        return;
                      }
                      // Count distinct engineers for the project.
                      //   0 engineers (cold) → skill-match a new engineer
                      //     via the existing intake flow.
                      //   1+ engineers (warm) → engineerPicker step, which
                      //     shows the engineer(s) by name + availability
                      //     state (Available/Busy/Offline) with state-
                      //     appropriate actions: Connect / Request /
                      //     Schedule. The picker also exposes the
                      //     "Request a different engineer" fallback so
                      //     the client in a rush can route around a busy
                      //     or offline engineer.
                      const distinctEngineers = new Set<string>();
                      for (const s of past) {
                        if (s.projectId === projectId && s.agent) {
                          distinctEngineers.add(s.agent);
                        }
                      }
                      if (distinctEngineers.size >= 1) {
                        setPickerProjectId(projectId);
                        setConnectFlow("engineerPicker");
                      } else {
                        onStartInProject(projectId);
                      }
                    }}
                    onRenameProject={onRenameProject}
                    onSelectProject={onSelectProject}
                    pinnedIds={pinnedIds}
                    onTogglePin={togglePin}
                    onPrepareSession={onPrepareSession}
                    draftsTick={draftsTick}
                    onDeleteProject={onDeleteProject}
                    onMarkProjectComplete={onMarkProjectComplete}
                  />
                ))
              : (
                <p className="px-2 py-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {searchQuery
                    ? `No projects or sessions match "${searchQuery}".`
                    : "Start your first project to get going."}
                </p>
              );
          }

          // ── Session view: flatten across all projects ───────────
          // projectGroups already applied status filter + search filter
          // + pin-aware sort. We just flatten and (optionally) bucket
          // by date. Each session row carries its project name so the
          // user doesn't lose project context.
          const allSessions = projectGroups.flatMap((g) => g.sessions);
          if (allSessions.length === 0) {
            return (
              <p className="px-2 py-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {searchQuery
                  ? `No sessions match "${searchQuery}".`
                  : statusFilter === "active"
                    ? "No active sessions."
                    : statusFilter === "completed"
                      ? "No completed sessions yet."
                      : "No sessions yet."}
              </p>
            );
          }

          // Date-bucketed flat list. Sessions get grouped under
          // Today / Yesterday / This week / Earlier headers. Project
          // names are hidden from each row (showProjectName=false)
          // because the bucket header is doing the temporal work and
          // the per-row project chip becomes noise in this view —
          // the user picked Date specifically to see sessions across
          // projects ordered by when they happened.
          const bucketed = bucketSessionsByDate(allSessions);
          return (
            <div className="flex flex-col gap-3">
              {bucketed.map((bucket) => (
                <div key={bucket.label}>
                  <div
                    className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {bucket.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {bucket.sessions.map((s) => (
                        <SessionRowFlat
                          key={s.id}
                          session={s}
                          isPinned={pinnedIds.has(s.id)}
                          isViewing={viewingPastId === s.id}
                          isCurrent={
                            !!session
                            && s.id === session.id
                            && !["ended", "cancelled", "abandoned"].includes(s.status)
                          }
                          onClick={() => onViewPast(s.id)}
                          onTogglePin={() => togglePin(s.id)}
                          showProjectName={false}
                        />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Quote-request shortcuts — sit directly above the user pill so
          they're always reachable but visually quieter than the primary
          session/project nav. Two leads:
            • GoLive   — customer wants to ship the project
            • Maintain — ongoing maintenance / enhancement
          Both open the same QuoteRequestModal, distinguished by kind.
          Suppressed for employees: their org runs on a separate billing
          relationship; the quote flow is for direct-billed customers.
          NB: the /api/customer/me-employment route returns an EmployeeInfo
          object even for non-employees (with isEmployee: false), so we
          gate on the explicit boolean instead of `!employment` — see the
          isEmployee derivation at the top of the parent RoomClient. */}
      {!employment?.isEmployee && (
        <div className="border-t px-2 pt-2 pb-1" style={{ borderColor: "var(--border)" }}>
          {/* group/quote class lets us drive the icon's hover state from the
              row, not just the icon itself. translateX + icon-color flip
              gives the row a small "lean in" tell on hover without yelling. */}
          <button
            type="button"
            onClick={() => setQuoteFlow("golive")}
            className="group/quote flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150 ease-out group-hover/quote:scale-110 group-hover/quote:bg-[var(--primary)] group-hover/quote:text-white group-hover/quote:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            >
              <Rocket size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px]" style={{ color: "var(--text)" }}>
                Quote to GoLive
              </span>
              <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                Ship this project — get a quote
              </span>
            </span>
          </button>

          {/* Hairline separator — lighter than the section's outer border
              so the two rows still read as a group, just clearly distinct.
              mx-2 indents past the buttons' left padding so it doesn't
              touch the icons. */}
          <div className="mx-2 my-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--border) 60%, transparent)" }} />

          <button
            type="button"
            onClick={() => setQuoteFlow("maintain")}
            className="group/quote flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150 ease-out group-hover/quote:scale-110 group-hover/quote:bg-[var(--primary)] group-hover/quote:text-white group-hover/quote:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
              style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            >
              <Wrench size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px]" style={{ color: "var(--text)" }}>
                Quote to Maintain / Enhance
              </span>
              <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                Ongoing work — get an estimate
              </span>
            </span>
          </button>
        </div>
      )}

      {/* Profile (bottom) — extra bottom padding lifts the user pill +
          quote shortcuts off the very edge of the viewport so the
          eye doesn't read them as "stuck at the bottom." */}
      <div className="relative border-t p-2 pb-6" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          className="group/userpill flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase transition-transform duration-150 ease-out group-hover/userpill:scale-110"
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
          <ChevronDown
            size={12}
            className={`transition-transform duration-150 ease-out group-hover/userpill:translate-y-0.5 ${userMenuOpen ? "rotate-180" : ""}`}
            style={{ color: "var(--text-muted)" }}
          />
        </button>
        {userMenuOpen && (
          <UserMenu
            email={email}
            session={session}
            entitlement={entitlement}
            employment={employment}
            onRecharge={() => { setUserMenuOpen(false); onWalletClick(); }}
            onOpenProfile={() => { setUserMenuOpen(false); onOpenProfile(); }}
            onOpenBilling={() => { setUserMenuOpen(false); onOpenBilling(); }}
            onOpenLegal={(kind) => { setUserMenuOpen(false); onOpenLegal(kind); }}
            onClose={() => setUserMenuOpen(false)}
          />
        )}
      </div>

      {/* Quote-request modal — same component for both GoLive and
          Maintain leads; the `kind` prop drives the copy + the RPC
          payload. We feed it the existing project list (filtered to
          real projects, not the synthetic "general" bucket). If a
          project was already selected when the customer opened the
          modal, pre-fill it so they skip step 1. */}
      {quoteFlow !== null && (
        <QuoteRequestModal
          kind={quoteFlow}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          initialProjectId={selectedProjectId}
          onClose={() => setQuoteFlow(null)}
        />
      )}

      {/* Connect-flow modal — 5-step micro-flow now. */}
      {connectFlow !== null && (
        <ConnectFlowModal
          step={connectFlow}
          mode={connectFlowMode}
          projects={projectGroups.filter((g) => g.key !== "general")}
          // ── engineerPicker context: which project was picked + the
          //    engineers who've worked on it (derived from past sessions).
          pickerProjectId={pickerProjectId}
          pickerProjectName={
            pickerProjectId
              ? projectGroups.find((g) => g.key === pickerProjectId)?.name ?? null
              : null
          }
          pickerEngineers={(() => {
            if (!pickerProjectId) return [];
            // Distinct engineer names for this project (most-recent first).
            const seen = new Map<string, { name: string; lastDate: string }>();
            for (const s of past) {
              if (s.projectId !== pickerProjectId || !s.agent) continue;
              const existing = seen.get(s.agent);
              if (!existing || new Date(s.date) > new Date(existing.lastDate)) {
                seen.set(s.agent, { name: s.agent, lastDate: s.date });
              }
            }
            return Array.from(seen.values()).sort(
              (a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime(),
            );
          })()}
          newProjectType={newProjectType}
          setNewProjectType={setNewProjectType}
          newProjectTypeOther={newProjectTypeOther}
          setNewProjectTypeOther={setNewProjectTypeOther}
          newProjectAiTools={newProjectAiTools}
          setNewProjectAiTools={setNewProjectAiTools}
          newProjectBackend={newProjectBackend}
          setNewProjectBackend={setNewProjectBackend}
          newProjectFrontend={newProjectFrontend}
          setNewProjectFrontend={setNewProjectFrontend}
          newProjectName={newProjectName}
          setNewProjectName={setNewProjectName}
          submitting={newProjectSubmitting}
          onChooseNew={() => setConnectFlow("details")}
          onChooseExisting={() => setConnectFlow("existing")}
          onPickProject={(projectId) => {
            // Route into engineerPicker for that project. If the
            // project has zero engineer history, jump straight into
            // intake (no one to pick between).
            const hasEngineers = past.some(
              (s) => s.projectId === projectId && !!s.agent,
            );
            if (hasEngineers) {
              setPickerProjectId(projectId);
              setConnectFlow("engineerPicker");
            } else {
              setConnectFlow(null);
              onStartInProject(projectId);
            }
          }}
          onEngineerConnect={(_engineerName) => {
            // v1: route through the existing intake flow for this
            // project. v2 TODO: pass _preferred_agent_id to
            // match_engineer so the picked engineer is routed first.
            const pid = pickerProjectId;
            setConnectFlow(null);
            setPickerProjectId(null);
            if (pid) onStartInProject(pid);
          }}
          onEngineerRequest={(engineerName) => {
            // Busy-state request flow. The "drop a request, joins after"
            // experience needs the engineer-side request inbox + the
            // engineer_connect_requests table + customer_request_engineer
            // RPC — all tracked in the engineer-parity plan and not yet
            // shipped. Until then we run the customer through the
            // standard match flow (mints session + intake + fires
            // match_engineer) and surface a toast that's honest about
            // what's happening: their request goes out, the preferred
            // engineer can pick it up when they wrap up, or any other
            // matched engineer can take it if the customer is willing.
            //
            // Removed the previous engineer_profiles.display_alias
            // lookup (the column doesn't exist on engineer_profiles —
            // engineer names live on guest_calls.agent for past
            // sessions) + the call to customer_request_engineer RPC
            // (doesn't exist yet). Both were unconditionally falling
            // into the "Couldn't locate Kai" alert.
            const pid = pickerProjectId;
            setConnectFlow(null);
            setPickerProjectId(null);
            onPickerToast(
              `Request sent to ${engineerName} — they'll join when they wrap their current call, or we'll route you to another engineer if you'd rather not wait.`,
            );
            if (pid) onStartInProject(pid);
          }}
          onEngineerSchedule={(engineerName) => {
            // Offline-state schedule flow. The "book their calendar"
            // experience needs the engineer_availability_windows table
            // + booking RPCs — also tracked on the engineer-parity plan
            // and not yet shipped. Until calendars exist, gracefully
            // degrade to the same "request and they'll come back to
            // you" path as Busy so the customer is never stuck.
            //
            // Same removal as Request: dropped the broken
            // engineer_profiles.display_alias lookup that produced
            // "Couldn't locate Kai's calendar."
            const pid = pickerProjectId;
            setConnectFlow(null);
            setPickerProjectId(null);
            onPickerToast(
              `Calendar booking for ${engineerName} is coming soon. We've queued a request — they'll join when they're back online.`,
            );
            if (pid) onStartInProject(pid);
          }}
          onPickerRequestDifferent={() => {
            // "Request a different engineer" — fall through to a fresh
            // intake on the same project. The match_engineer RPC will
            // pick any engineer with the right skills, biased away
            // from the ones already shown.
            const pid = pickerProjectId;
            setConnectFlow(null);
            setPickerProjectId(null);
            if (pid) onStartInProject(pid);
          }}
          onPickerBack={() => setConnectFlow("existing")}
          onDetailsNext={() => setConnectFlow("name")}
          onNameBack={() => setConnectFlow("details")}
          onSubmitNewProject={async () => {
            setNewProjectSubmitting(true);
            const projectType =
              newProjectType === "Other"
                ? newProjectTypeOther.trim() || "Other"
                : newProjectType;
            const payload = {
              name: newProjectName.trim(),
              projectType,
              aiTools: newProjectAiTools,
              backend: newProjectBackend,
              frontend: newProjectFrontend,
            };
            try {
              if (connectFlowMode === "create-only") {
                await onCreateProjectWithMetadata(payload);
              } else {
                await onStartNewProject(payload);
              }
              setConnectFlow(null);
              setConnectFlowMode("connect");
              resetNewProjectForm();
            } catch (err) {
              console.warn("[connect-flow] submit failed:", err);
              setNewProjectSubmitting(false);
            }
          }}
          onBack={() => setConnectFlow("choose")}
          onClose={() => {
            setConnectFlow(null);
            setConnectFlowMode("connect");
            setPickerProjectId(null);
            resetNewProjectForm();
          }}
        />
      )}

      {scheduleTarget && (
        <ScheduleEngineerModal
          engineerUserId={scheduleTarget.engineerUserId}
          engineerName={scheduleTarget.engineerName}
          projectId={scheduleTarget.projectId}
          onClose={() => setScheduleTarget(null)}
          onBooked={({ slotStart }) => {
            const when = new Date(slotStart).toLocaleString();
            setScheduleTarget(null);
            window.alert(`Booked with ${scheduleTarget.engineerName} for ${when}.`);
          }}
        />
      )}
    </aside>
  );
});

// ── Sort/filter row inside the popover panel ───────────────────────────────
// One row per filter, with click-to-expand inline submenu. The header
// row shows label + current value + chevron. Clicking the row toggles
// its submenu open below; the submenu lists all available options. Click
// an option to select it (auto-collapses the submenu). `highlight` shows
// the value in brand green when an active (non-default) filter is set,
// so the user sees at a glance which controls are doing work. `last`
// drops the bottom border between rows.
function SortRow({
  label, value, options, expanded, onToggle, onSelect, highlight, last,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  expanded: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(!last && "border-b")}
      style={!last ? { borderColor: "var(--border)" } : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-raised)]"
      >
        <span className="text-[13px]" style={{ color: "var(--text)" }}>
          {label}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="text-[12px]"
            style={{ color: highlight ? BRAND_GREEN : "var(--text-muted)" }}
          >
            {value}
          </span>
          <ChevronRight
            size={12}
            style={{
              color: "var(--text-muted)",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
        </span>
      </button>

      {expanded && (
        <div
          className="border-t bg-[color-mix(in_srgb,var(--text)_3%,transparent)]"
          style={{ borderColor: "var(--border)" }}
        >
          {options.map((opt) => {
            const isSelected = opt.label === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelect(opt.value)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-raised)]"
                aria-pressed={isSelected}
              >
                <span
                  className="text-[12px]"
                  style={{
                    color: isSelected ? BRAND_GREEN : "var(--text)",
                    fontWeight: isSelected ? 500 : 400,
                  }}
                >
                  {opt.label}
                </span>
                {isSelected && (
                  <Check size={12} style={{ color: BRAND_GREEN }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Connect-flow modal ─────────────────────────────────────────────────────
// 4-step micro-flow that runs when the customer clicks Connect on the
// Get-your-engineer widget:
//   step="choose"   — new vs existing project
//   step="existing" — pick from existing projects (skips to session start)
//   step="details"  — compact form: project type + AI tool + backend + frontend
//   step="name"     — enter a project name; submit creates + starts session

// Project types — calibrated for the actual Relay audience: HR managers,
// Finance/CFO, Product managers, Marketing/CMO, Sales, CEO/COO, L&D, and
// other non-technical execs building with AI tools (Lovable, Cursor, v0,
// Replit, etc.). The list is *what they ship*, not *what they call
// themselves* — the same person often builds across categories.
//
// Order roughly by frequency observed in the early customer pool:
// internal dashboards and landing pages lead; CRMs and storefronts trail.
const NEW_PROJECT_TYPES: ReadonlyArray<{ value: string; emoji: string }> = [
  { value: "Internal dashboard / KPI tracker", emoji: "📊" },
  { value: "Marketing landing page",            emoji: "🌐" },
  { value: "Customer portal / Web app",         emoji: "💻" },
  { value: "Lead capture / Form tool",          emoji: "📋" },
  { value: "Internal workflow / Automation",    emoji: "⚙️" },
  { value: "Knowledge base / Wiki",             emoji: "📚" },
  { value: "AI chatbot / Assistant",            emoji: "🤖" },
  { value: "Reporting / Analytics tool",        emoji: "📈" },
  { value: "CRM / Customer tracker",            emoji: "👥" },
  { value: "Booking / Scheduling app",          emoji: "📅" },
  { value: "Training / Course platform",        emoji: "🎓" },
  { value: "E-commerce storefront",             emoji: "🛒" },
  { value: "Mobile app",                        emoji: "📱" },
  { value: "Other",                             emoji: "✨" },
];

// The `client_intakes.developing` column has a strict CHECK constraint
// (Website | Mobile App | IoT System | AIML product). NEW_PROJECT_TYPES
// is persona-driven (dashboards, CRMs, e-commerce, etc.) so we map every
// persona type back to one of the four allowed buckets before writing
// the row. Without this map, the upsert silently fails and the customer
// gets bounced to /intake on their next phone-click instead of straight
// to engineer matching.
type DevelopingKind = "Website" | "Mobile App" | "IoT System" | "AIML product";
function mapProjectTypeToDeveloping(projectType: string | null | undefined): DevelopingKind {
  if (!projectType) return "Website";
  const v = projectType.toLowerCase();
  // Direct passthroughs for callers that already supply a valid value.
  if (v === "website")        return "Website";
  if (v === "mobile app")     return "Mobile App";
  if (v === "iot system")     return "IoT System";
  if (v === "aiml product")   return "AIML product";
  // Persona mapping: mobile, AI, IoT, else everything web-ish → Website.
  if (v.includes("mobile"))                                    return "Mobile App";
  if (v.includes("ai ") || v.includes("chatbot") || v.includes("assistant") || v.includes("aiml")) return "AIML product";
  if (v.includes("iot") || v.includes("device") || v.includes("hardware")) return "IoT System";
  return "Website";
}

// AI tools the customer might be building with. Aligned with the homepage
// "AI tools we support" pill row + the lib/relay/profile STACK_OPTIONS.
const NEW_PROJECT_AI_TOOLS: ReadonlyArray<string> = [
  "Claude", "ChatGPT", "Cursor", "Lovable", "v0", "Replit", "Bolt", "Windsurf", "Other",
];
const NEW_PROJECT_BACKENDS: ReadonlyArray<string> = [
  "Supabase", "Firebase", "Vercel", "AWS", "Postgres", "MongoDB", "Node.js", "Python", "Not sure",
];
const NEW_PROJECT_FRONTENDS: ReadonlyArray<string> = [
  "React", "Next.js", "Vue", "Plain HTML/CSS", "Tailwind", "React Native", "Flutter", "Not sure",
];

function ConnectFlowModal({
  step, mode, projects,
  pickerProjectId, pickerProjectName, pickerEngineers,
  newProjectType, setNewProjectType,
  newProjectTypeOther, setNewProjectTypeOther,
  newProjectAiTools, setNewProjectAiTools,
  newProjectBackend, setNewProjectBackend,
  newProjectFrontend, setNewProjectFrontend,
  newProjectName, setNewProjectName,
  submitting,
  onChooseNew, onChooseExisting, onPickProject,
  onEngineerConnect, onEngineerRequest, onEngineerSchedule,
  onPickerRequestDifferent, onPickerBack,
  onDetailsNext, onNameBack, onSubmitNewProject,
  onBack, onClose,
}: {
  step: "choose" | "existing" | "engineerPicker" | "details" | "name";
  mode: "connect" | "create-only";
  projects: ProjectGroup[];
  pickerProjectId: string | null;
  pickerProjectName: string | null;
  /** Engineers who've worked on the picked project (deduped, most-recent
   *  first). lastDate is the most recent session they had on this project. */
  pickerEngineers: { name: string; lastDate: string }[];
  newProjectType: string;
  setNewProjectType: (s: string) => void;
  newProjectTypeOther: string;
  setNewProjectTypeOther: (s: string) => void;
  newProjectAiTools: string[];
  setNewProjectAiTools: React.Dispatch<React.SetStateAction<string[]>>;
  newProjectBackend: string[];
  setNewProjectBackend: React.Dispatch<React.SetStateAction<string[]>>;
  newProjectFrontend: string[];
  setNewProjectFrontend: React.Dispatch<React.SetStateAction<string[]>>;
  newProjectName: string;
  setNewProjectName: (s: string) => void;
  submitting: boolean;
  onChooseNew: () => void;
  onChooseExisting: () => void;
  onPickProject: (projectId: string) => void;
  /** Picked-engineer actions (engineerPicker step). */
  onEngineerConnect: (engineerName: string) => void;
  onEngineerRequest: (engineerName: string) => void;
  onEngineerSchedule: (engineerName: string) => void;
  /** "Request a different engineer" fallback. */
  onPickerRequestDifferent: () => void;
  onPickerBack: () => void;
  onDetailsNext: () => void;
  onNameBack: () => void;
  onSubmitNewProject: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const toggleMultiSelect = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
  ) => {
    setter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  // The "details" step requires ALL four sections to have at least one
  // selection (project type + AI tool + backend + frontend). "Not sure"
  // is a valid option in backend/frontend so the user always has a path
  // forward — they don't need to know the answer, just acknowledge the
  // question. Name step has a hard-required name.
  const detailsValid =
    newProjectType.trim().length > 0 &&
    (newProjectType !== "Other" || newProjectTypeOther.trim().length > 0) &&
    newProjectAiTools.length > 0 &&
    newProjectBackend.length > 0 &&
    newProjectFrontend.length > 0;
  const nameValid = newProjectName.trim().length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className={cn(
          "relative w-full rounded-2xl border p-6 shadow-2xl",
          // Wider modal for the details step (form is content-heavy);
          // narrower for the lighter steps so they don't feel sparse.
          step === "details" ? "max-w-xl" : "max-w-md",
        )}
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={16} />
        </button>

        {step === "choose" && (
          <>
            <h2
              className="text-[18px] font-semibold"
              style={{ color: "var(--text)" }}
            >
              Is this for a new project or an existing one?
            </h2>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              We'll route your session to the right project so the context
              stays together.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={onChooseExisting}
                disabled={projects.length === 0}
                className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <div className="text-[14px] font-medium" style={{ color: "var(--text)" }}>
                    Existing project
                  </div>
                  <div className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
                    {projects.length === 0
                      ? "You don't have any projects yet — start a new one."
                      : `Pick from your ${projects.length} project${projects.length === 1 ? "" : "s"}.`}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
              </button>
              <button
                type="button"
                onClick={onChooseNew}
                className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:bg-[var(--surface-raised)]"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <div className="text-[14px] font-medium" style={{ color: "var(--text)" }}>
                    New project
                  </div>
                  <div className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
                    Tell us what you're building, then we'll connect you.
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>
          </>
        )}

        {step === "existing" && (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                aria-label="Back"
                className="rounded-md p-1 transition-opacity hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
              >
                <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              </button>
              <h2
                className="text-[18px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                Pick a project
              </h2>
            </div>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              The session will be filed under the project you choose.
            </p>
            <div className="mt-4 flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {projects.length === 0 ? (
                <p className="px-2 py-4 text-[13px]" style={{ color: "var(--text-muted)" }}>
                  No projects yet.
                </p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onPickProject(p.key)}
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Folder size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <span className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
                        {p.name}
                      </span>
                    </div>
                    <span className="ml-2 shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {p.sessions.length} {p.sessions.length === 1 ? "session" : "sessions"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {step === "engineerPicker" && (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={onPickerBack}
                aria-label="Back"
                className="rounded-md p-1 transition-opacity hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
              >
                <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              </button>
              <h2
                className="text-[18px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                Pick your engineer
              </h2>
            </div>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {pickerProjectName ? (
                <>
                  These engineers have worked with you on <strong style={{ color: "var(--text)" }}>{pickerProjectName}</strong>.
                  Pick one to continue with — or request a different
                  engineer if you need fresh eyes.
                </>
              ) : (
                "Choose an engineer to connect with."
              )}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {pickerEngineers.map((eng, i) => {
                // v1 placeholder availability — most recent engineer is
                // "Available", next is "Busy", everyone else is "Offline".
                // Replace with real engineer_presence subscription in v2.
                const availability: "available" | "busy" | "offline" =
                  i === 0 ? "available" : i === 1 ? "busy" : "offline";
                return (
                  <EngineerPickerRow
                    key={eng.name}
                    engineerName={eng.name}
                    lastSessionDate={eng.lastDate}
                    availability={availability}
                    onConnect={() => onEngineerConnect(eng.name)}
                    onRequest={() => onEngineerRequest(eng.name)}
                    onSchedule={() => onEngineerSchedule(eng.name)}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={onPickerRequestDifferent}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              <UserPlus size={13} />
              Request a different engineer
            </button>
          </>
        )}

        {step === "details" && (
          <DetailsStep
            onBack={onBack}
            newProjectType={newProjectType}
            setNewProjectType={setNewProjectType}
            newProjectTypeOther={newProjectTypeOther}
            setNewProjectTypeOther={setNewProjectTypeOther}
            newProjectAiTools={newProjectAiTools}
            setNewProjectAiTools={setNewProjectAiTools}
            newProjectBackend={newProjectBackend}
            setNewProjectBackend={setNewProjectBackend}
            newProjectFrontend={newProjectFrontend}
            setNewProjectFrontend={setNewProjectFrontend}
            toggleMultiSelect={toggleMultiSelect}
            detailsValid={detailsValid}
            onDetailsNext={onDetailsNext}
          />
        )}

        {step === "name" && (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={onNameBack}
                aria-label="Back"
                className="rounded-md p-1 transition-opacity hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
              >
                <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              </button>
              <h2
                className="text-[18px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                Name this project
              </h2>
            </div>
            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              Pick a name you'll recognize when you come back. You can rename
              it later.
            </p>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="e.g. ATLAS Project, Acme Landing, Mobile MVP"
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameValid && !submitting) onSubmitNewProject();
              }}
              className="mt-5 w-full rounded-md border px-3 py-2.5 text-[14px] outline-none focus:ring-2"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--background)",
                color: "var(--text)",
              }}
            />
            <button
              type="button"
              onClick={onSubmitNewProject}
              disabled={!nameValid || submitting}
              className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  {mode === "create-only" ? "Creating…" : "Starting…"}
                </>
              ) : mode === "create-only" ? (
                <>
                  <Folder size={13} />
                  Create project
                </>
              ) : (
                <>
                  <Phone size={13} />
                  Create project &amp; connect engineer
                </>
              )}
            </button>
            {mode === "create-only" && (
              <p
                className="mt-3 text-center text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                You can call an engineer later from this project's row.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Date bucket helper for session-view ────────────────────────────────────
// Groups a flat session list into Today / Yesterday / This week / Earlier
// buckets. Empty buckets are dropped from the return value so the sidebar
// doesn't render section headers with no content.
function bucketSessionsByDate(sessions: PastSession[]): { label: string; sessions: PastSession[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekAgoStart = todayStart - 7 * 86_400_000;

  const buckets: { label: string; sessions: PastSession[] }[] = [
    { label: "Today",     sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "This week", sessions: [] },
    { label: "Earlier",   sessions: [] },
  ];
  for (const s of sessions) {
    const t = new Date(s.date).getTime();
    if (t >= todayStart) buckets[0].sessions.push(s);
    else if (t >= yesterdayStart) buckets[1].sessions.push(s);
    else if (t >= weekAgoStart) buckets[2].sessions.push(s);
    else buckets[3].sessions.push(s);
  }
  return buckets.filter((b) => b.sessions.length > 0);
}

// ── Session row used in the flat session view ──────────────────────────────
// Same visual register as the rows inside ProjectAccordion, but flatter
// (no folder context) and with the project name surfaced in the meta line
// (so the user doesn't lose project context when viewing across projects).
// Pin button overlays the top-right just like in the accordion.
function SessionRowFlat({
  session, isPinned, isViewing, isCurrent, onClick, onTogglePin, showProjectName = true,
}: {
  session: PastSession;
  isPinned: boolean;
  isViewing: boolean;
  isCurrent: boolean;
  onClick: () => void;
  onTogglePin: () => void;
  /** Show the first-two-words project chip in the meta line. Hidden
   *  when groupBy=date (the date bucket headers carry temporal
   *  context; per-row project chips become noise). Defaults to true
   *  so existing call sites continue rendering as before. */
  showProjectName?: boolean;
}) {
  const isActive = !["ended", "abandoned", "cancelled"].includes(session.status);
  const fmtRelDate = (d: Date) => {
    const now = new Date();
    const t = d.getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diffDays = Math.floor((today - t) / 86_400_000);
    if (diffDays < 1) return "Today";
    if (diffDays < 2) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  return (
    <div className="relative group/session">
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 pr-7 text-left transition-colors",
          isViewing
            ? "border-[var(--primary)] bg-[var(--primary-tint)]"
            : isCurrent
              ? "border-[var(--primary)] bg-[var(--primary-tint)]/60"
              : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-raised)]",
        )}
      >
        <span
          className={cn(
            "relative mt-1.5 flex h-2 w-2 shrink-0 rounded-full",
            isActive ? "bg-[var(--primary)]" : "bg-[var(--text-faint)]",
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
          {/* Top line: session topic (just the topic, no date suffix —
              the meta line below carries the date). */}
          <div
            className={cn(
              "truncate text-[13px]",
              isViewing || isCurrent ? "font-medium" : "",
            )}
            style={{ color: "var(--text)" }}
          >
            {session.topic}
          </div>
          {/* Meta: first two words of the project name (compact context
              reference), then the relative date, then the status pill
              when terminal. The agent name was removed to keep the line
              short — the user is in flat view to see across projects,
              not to see engineer attributions per row. */}
          <div
            className="mt-0.5 flex items-center gap-1 text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {showProjectName && session.projectName && (
              <>
                <span className="truncate">
                  {session.projectName.split(/\s+/).slice(0, 2).join(" ")}
                </span>
                <span>·</span>
              </>
            )}
            <span>{fmtRelDate(new Date(session.date))}</span>
            {!isActive && (
              <>
                <span>·</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                    session.status === "ended"
                      ? "bg-[var(--surface-raised)] text-[var(--text-muted)]"
                      : session.status === "cancelled"
                        ? "bg-[var(--warn-soft)] text-[var(--warn)]"
                        : "bg-[var(--risk-soft)] text-[var(--risk)]",
                  )}
                >
                  {session.status}
                </span>
              </>
            )}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={isPinned ? "Unpin session" : "Pin session"}
        aria-label={isPinned ? "Unpin session" : "Pin session"}
        aria-pressed={isPinned}
        className={cn(
          "absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md transition-all",
          isPinned
            ? "opacity-100"
            : "opacity-0 group-hover/session:opacity-60 hover:opacity-100",
        )}
        style={{ color: isPinned ? BRAND_GREEN : "var(--text-muted)" }}
      >
        <Pin size={11} fill={isPinned ? BRAND_GREEN : "none"} strokeWidth={isPinned ? 2 : 1.8} />
      </button>
    </div>
  );
}

// ── Engineer picker row (engineerPicker step) ──────────────────────────────
// One row per engineer, showing avatar + name + availability state + the
// state-appropriate action button (Connect / Request / Schedule). The
// row's right edge gives the dominant action visual weight; secondary
// state info (the date of the most recent session) sits as a small line
// under the name.
//
// TODO(presence): availability is a v1 placeholder. Wire to real
// engineer_presence subscriptions in v2 so Online/Busy/Offline flip
// based on actual engineer activity.
function EngineerPickerRow({
  engineerName, lastSessionDate, availability,
  onConnect, onRequest, onSchedule,
}: {
  engineerName: string;
  lastSessionDate: string;
  availability: "available" | "busy" | "offline";
  onConnect: () => void;
  onRequest: () => void;
  onSchedule: () => void;
}) {
  const firstName = engineerName.split(" ")[0];
  const lastDate = new Date(lastSessionDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const stateMeta = {
    available: { dot: BRAND_GREEN, label: "Available now", ring: true },
    busy:      { dot: "#f59e0b",   label: "Busy", ring: false },
    offline:   { dot: "var(--text-faint)", label: "Offline", ring: false },
  }[availability];

  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Avatar */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold uppercase"
        style={{
          backgroundColor:
            availability === "available" ? BRAND_GREEN_SOFT : "var(--surface-raised)",
          color: availability === "available" ? BRAND_GREEN : "var(--text-muted)",
        }}
      >
        {engineerName[0]}
      </div>

      {/* Name + status */}
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[13px] font-medium"
          style={{ color: "var(--text)" }}
        >
          {engineerName}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span className="relative inline-flex h-1.5 w-1.5">
            {stateMeta.ring && (
              <span
                className="absolute inset-0 inline-flex animate-ping rounded-full opacity-60"
                style={{ backgroundColor: stateMeta.dot as string }}
              />
            )}
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: stateMeta.dot as string }}
            />
          </span>
          {stateMeta.label}
          <span style={{ opacity: 0.6 }}> · last {lastDate}</span>
        </div>
      </div>

      {/* State-appropriate action */}
      {availability === "available" && (
        <button
          type="button"
          onClick={onConnect}
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          <Phone size={11} />
          Connect
        </button>
      )}
      {availability === "busy" && (
        <button
          type="button"
          onClick={onRequest}
          title={`Send ${firstName} a request to connect when free`}
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[var(--surface-raised)]"
          style={{ borderColor: "#f59e0b", color: "#b45309" }}
        >
          <Clock size={11} />
          Request
        </button>
      )}
      {availability === "offline" && (
        <button
          type="button"
          onClick={onSchedule}
          title={`Open ${firstName}'s calendar to schedule`}
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[var(--surface-raised)]"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <Clock size={11} />
          Schedule
        </button>
      )}
    </div>
  );
}

// ── Details step (new-project form) ────────────────────────────────────────
// Extracted from the modal body so the form gets its own component scope
// and the modal stays readable. Visual treatment was reworked to reduce
// the cluttered feel of the original 4-section flat layout:
//
//   - Each section sits in a soft panel with a subtle background tint
//     and explicit padding, so the eye reads them as distinct groups
//     instead of one long pile of chips.
//   - Backend & Frontend (both optional) are grouped under a single
//     collapsible "Stack details" panel so they don't compete for
//     attention with the required fields above.
//   - Section headers now show a small count chip ("3" or "—") next to
//     the label so the user can see at a glance how many they've picked.
//   - Chip padding bumped slightly (px-3 instead of px-2.5) for breathing
//     room. Same color treatment as before — green outline + soft fill
//     for selected.
function DetailsStep({
  onBack,
  newProjectType, setNewProjectType,
  newProjectTypeOther, setNewProjectTypeOther,
  newProjectAiTools, setNewProjectAiTools,
  newProjectBackend, setNewProjectBackend,
  newProjectFrontend, setNewProjectFrontend,
  toggleMultiSelect,
  detailsValid, onDetailsNext,
}: {
  onBack: () => void;
  newProjectType: string;
  setNewProjectType: (s: string) => void;
  newProjectTypeOther: string;
  setNewProjectTypeOther: (s: string) => void;
  newProjectAiTools: string[];
  setNewProjectAiTools: React.Dispatch<React.SetStateAction<string[]>>;
  newProjectBackend: string[];
  setNewProjectBackend: React.Dispatch<React.SetStateAction<string[]>>;
  newProjectFrontend: string[];
  setNewProjectFrontend: React.Dispatch<React.SetStateAction<string[]>>;
  toggleMultiSelect: (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => void;
  detailsValid: boolean;
  onDetailsNext: () => void;
}) {
  // All four sections (project type, AI tool, backend, frontend) are
  // required and always visible. The Stack Details accordion was removed
  // — the form now reads as a flat checklist of 4 required panels.
  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Back"
          className="rounded-md p-1 transition-opacity hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
        </button>
        <h2
          className="text-[18px] font-semibold"
          style={{ color: "var(--text)" }}
        >
          What are you building?
        </h2>
      </div>
      <p
        className="mt-2 text-[13px] leading-relaxed"
        style={{ color: "var(--text-muted)" }}
      >
        Your engineer needs the shape of the project + the stack so they
        can hit the ground running.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {/* Project type */}
        <FormPanel label="Project type" count={newProjectType ? 1 : 0} required>
          <div className="flex flex-wrap gap-2">
            {NEW_PROJECT_TYPES.map((t) => (
              <ChoiceChip
                key={t.value}
                label={t.value}
                emoji={t.emoji}
                selected={newProjectType === t.value}
                onClick={() => setNewProjectType(t.value)}
              />
            ))}
          </div>
          {newProjectType === "Other" && (
            <input
              type="text"
              value={newProjectTypeOther}
              onChange={(e) => setNewProjectTypeOther(e.target.value)}
              placeholder="Describe what you're building"
              maxLength={120}
              autoFocus
              className="mt-3 w-full rounded-md border px-3 py-2 text-[13px] outline-none focus:ring-2"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--background)",
                color: "var(--text)",
              }}
            />
          )}
        </FormPanel>

        {/* AI tool */}
        <FormPanel
          label="AI tool you're building with"
          count={newProjectAiTools.length}
          required
        >
          <div className="flex flex-wrap gap-2">
            {NEW_PROJECT_AI_TOOLS.map((t) => (
              <ChoiceChip
                key={t}
                label={t}
                selected={newProjectAiTools.includes(t)}
                onClick={() => toggleMultiSelect(setNewProjectAiTools, t)}
              />
            ))}
          </div>
        </FormPanel>

        {/* Backend & infra — always visible, required */}
        <FormPanel
          label="Backend & infra"
          count={newProjectBackend.length}
          required
        >
          <div className="flex flex-wrap gap-2">
            {NEW_PROJECT_BACKENDS.map((t) => (
              <ChoiceChip
                key={t}
                label={t}
                selected={newProjectBackend.includes(t)}
                onClick={() => toggleMultiSelect(setNewProjectBackend, t)}
              />
            ))}
          </div>
        </FormPanel>

        {/* Frontend & UI — always visible, required */}
        <FormPanel
          label="Frontend & UI"
          count={newProjectFrontend.length}
          required
        >
          <div className="flex flex-wrap gap-2">
            {NEW_PROJECT_FRONTENDS.map((t) => (
              <ChoiceChip
                key={t}
                label={t}
                selected={newProjectFrontend.includes(t)}
                onClick={() => toggleMultiSelect(setNewProjectFrontend, t)}
              />
            ))}
          </div>
        </FormPanel>
      </div>

      <button
        type="button"
        onClick={onDetailsNext}
        disabled={!detailsValid}
        className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
      >
        Next: Name your project
        <ChevronRight size={14} />
      </button>
    </>
  );
}

// ── Visual panel wrapper used by the details form ──────────────────────────
// Lifts each section onto a soft tinted surface with consistent padding,
// so the form reads as 3 discrete cards (Type / AI / Stack) instead of a
// flat list of chips. count + required show a tiny status pill next to
// the section label — green when satisfied, red when required-and-empty.
function FormPanel({
  label, children, count, required,
}: {
  label: string;
  children: React.ReactNode;
  count: number;
  required?: boolean;
}) {
  const satisfied = count > 0;
  const showRequiredAlert = required && !satisfied;
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className="text-[12px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: "var(--text)" }}
        >
          {label}
        </span>
        {satisfied && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
            style={{
              backgroundColor: BRAND_GREEN_SOFT,
              color: BRAND_GREEN,
            }}
          >
            {count}
          </span>
        )}
        {showRequiredAlert && (
          <span
            className="text-[10px] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            pick one
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Form helpers used inside ConnectFlowModal ──────────────────────────────
function FormSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em]"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}

function ChoiceChip({
  label, emoji, selected, onClick,
}: {
  label: string;
  emoji?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        selected
          ? ""
          : "hover:bg-[var(--surface-raised)]",
      )}
      style={{
        borderColor: selected ? BRAND_GREEN : "var(--border)",
        backgroundColor: selected ? BRAND_GREEN_SOFT : "transparent",
        color: selected ? BRAND_GREEN : "var(--text)",
      }}
    >
      {emoji && <span aria-hidden="true">{emoji}</span>}
      {label}
    </button>
  );
}

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
  email, session, entitlement, employment, onRecharge, onOpenProfile, onOpenBilling, onOpenLegal, onClose, collapsed = false,
}: {
  email: string;
  session: GuestCall | null;
  entitlement: EntitlementShape;
  employment: EmployeeInfo | null;
  onRecharge: () => void;
  /** Open the in-pane Account view on the Profile tab. Replaces the
   *  prior router.push("/account") — the customer never leaves /room. */
  onOpenProfile: () => void;
  /** Open the in-pane Account view on the Billing tab — quick shortcut
   *  from the user-menu list, saves a click vs going through Profile
   *  first. */
  onOpenBilling: () => void;
  /** Open the in-pane Privacy / Terms viewer. Replaces the prior
   *  `<a target="_blank">` external links so the customer never
   *  leaves /room — the legal page mounts inline in the centre. */
  onOpenLegal: (kind: LegalKind) => void;
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

  // Learn-more entries. Open the canonical legal pages inline in the
  // /room central pane (LegalPane → iframe with ?embed=1). The
  // standalone /legal/* routes still exist and are crawlable for SEO
  // — this is just how the in-app menu reaches them.
  const learnMoreLinks: { icon: React.ReactNode; label: string; kind: LegalKind }[] = [
    { icon: <ShieldCheck size={15} />, label: "Privacy Policy", kind: "privacy" },
    { icon: <FileText size={15} />,    label: "Terms of Use",   kind: "terms"   },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Menu panel — uses --background (the darkest token) instead of
          --surface so the popup sits visibly deeper than the sidebar.
          In espresso that's #0d0703 (vs sidebar's #16100a); in dark
          it's #14171a (vs sidebar's #1c1f23); in light it's #f7f9f8
          (vs sidebar's #ffffff) — the menu is always one shade
          darker than its anchor. Shadow is bumped to keep the panel
          legible when it sits this deep on the dark themes. */}
      <div
        className="absolute z-50 w-64 rounded-xl border shadow-xl"
        style={{
          bottom: "calc(100% + 8px)",
          left: collapsed ? "48px" : "0px",
          backgroundColor: "var(--background)",
          borderColor: "var(--border)",
          boxShadow: "0 10px 36px rgba(0,0,0,0.45)",
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

        {/* Account actions — Profile & settings + Billing as siblings.
            Both open the AccountPane (different tabs), but Billing gets
            its own top-level entry so customers can jump straight to
            the purchase history without first landing on Profile. */}
        <div className="px-2 py-1.5">
          <button
            onClick={onOpenProfile}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text)" }}
          >
            <span style={{ color: "var(--text-muted)" }}><Settings size={15} /></span>
            Profile &amp; settings
          </button>
          <button
            onClick={onOpenBilling}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text)" }}
          >
            <span style={{ color: "var(--text-muted)" }}><Receipt size={15} /></span>
            Billing
          </button>
        </div>

        {/* Learn more — privacy + terms. Section header is non-interactive
            (it's a label, not a button) so the section feels like a grouped
            sub-list rather than three flat menu items. Links open in a new
            tab via target="_blank" + rel="noopener noreferrer" so the
            customer doesn't lose their /room session. */}
        <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
          <div
            className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--text-faint)" }}
          >
            Learn more
          </div>
          {learnMoreLinks.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={() => onOpenLegal(link.kind)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: "var(--text)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>{link.icon}</span>
              {link.label}
            </button>
          ))}
        </div>

        {/* Log out — sits in its own section so the danger color reads
            as a separate decision from the read-only learn-more links. */}
        <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "#e05c4b" }}
          >
            <span style={{ color: "#e05c4b" }}><LogOut size={15} /></span>
            Log out
          </button>
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
  pinnedIds, onTogglePin, onPrepareSession, draftsTick, onDeleteProject, onMarkProjectComplete,
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
  /** Set of session ids currently pinned. Pinned sessions float to the
   *  top of their group (sort is applied upstream in projectGroups) and
   *  render with a filled pin icon. */
  pinnedIds: Set<string>;
  /** Toggle pin state for a session id. */
  onTogglePin: (sessionId: string) => void;
  /** Open the central "Prepare a session" pane for this project. The
   *  second arg is an optional draft id — pass it to re-open an
   *  existing saved draft for editing. */
  onPrepareSession: (projectId: string, draftId?: string | null) => void;
  /** Bumped when any draft is saved / deleted. Forces a fresh
   *  localStorage read so newly-saved drafts surface immediately. */
  draftsTick: number;
  /** Open the 2-factor confirmation modal for deleting this project.
   *  The actual delete fires after the modal validates password + name
   *  + literal "delete the project" phrase. */
  onDeleteProject: (projectId: string, projectName: string) => void;
  /** Flip the project to 'completed' which starts the 90-day retention
   *  clock for chat-attachment purge. Reversible via the same menu while
   *  the project is still in 'completed' status. */
  onMarkProjectComplete: (projectId: string, projectName: string) => void;
}) {
  // Accordions start COLLAPSED on initial mount. Customers see the
  // project list first and drill into any project they want to act on
  // — either to start a new session or browse past sessions. This is
  // the "filing cabinet" mental model: the drawers stay closed until
  // you choose to pull one open.
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const [renameBusy, setRenameBusy] = useState(false);
  // The General bucket doesn't have a real project id and can't be
  // "started in" — sessions go there only as a fallback.
  const isGeneral = group.key === "general";
  const isSelected = !isGeneral && selectedProjectId === group.key;

  // Saved drafts for this project (from localStorage). Re-read whenever
  // draftsTick bumps (parent fires this after any save/delete) so newly
  // saved drafts surface in the sidebar immediately. The General bucket
  // doesn't carry drafts (drafts always belong to a real project id).
  const drafts = useMemo<SessionDraft[]>(() => {
    if (isGeneral) return [];
    return listDraftsForProject(group.key);
    // draftsTick included to invalidate the cache on save/delete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.key, draftsTick, isGeneral]);

  // Overflow menu state (… button) — Rename + Delete actions.
  const [overflowOpen, setOverflowOpen] = useState(false);
  // Close on outside-click.
  useEffect(() => {
    if (!overflowOpen) return;
    const t = setTimeout(() => {
      const handler = () => setOverflowOpen(false);
      document.addEventListener("click", handler);
      return () => document.removeEventListener("click", handler);
    }, 0);
    return () => clearTimeout(t);
  }, [overflowOpen]);

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
      {/* Project header. min-w-0 on the wrapper + button lets the long
          name actually shrink/wrap within the flex column instead of
          pushing the action buttons outside the sidebar's right edge. */}
      <div className="relative flex min-w-0 items-center">
        <button
          onClick={() => {
            setOpen((v) => !v);
            // General has no real project id — clicking it just toggles
            // open/close, no selection state.
            if (!isGeneral) onSelectProject(group.key);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-black/5 dark:hover:bg-white/5"
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
              className="min-w-0 flex-1 rounded-sm border px-1 py-0 text-[15px] font-semibold tracking-tight outline-none"
              style={{
                borderColor: BRAND_GREEN,
                backgroundColor: "var(--background)",
                color: "var(--text)",
              }}
            />
          ) : (
            // text wraps onto multiple lines for long names instead of
            // truncating + spilling. break-words lets a single absurdly
            // long token break mid-word. leading-tight keeps the line-
            // height tight when wrapped.
            <span
              className="min-w-0 flex-1 break-words text-[15px] font-normal leading-tight tracking-tight"
              style={{ color: isSelected ? BRAND_GREEN : "var(--text)" }}
            >
              {group.name}
            </span>
          )}
          {/* Lifecycle pill — only renders when non-active, so the default
              project list stays clean. "Completed" signals the 90-day
              retention clock has started; "Archived" is post-sweep. */}
          {!isGeneral && group.completionStatus !== "active" && (
            <span
              className="ml-1 shrink-0 rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: group.completionStatus === "completed"
                  ? "color-mix(in srgb, var(--warn) 18%, transparent)"
                  : "color-mix(in srgb, var(--text) 8%, transparent)",
                color: group.completionStatus === "completed" ? "var(--warn)" : "var(--text-muted)",
              }}
            >
              {group.completionStatus === "completed" ? "Completed" : "Archived"}
            </span>
          )}
          {/* Session-count badge removed — the count was redundant with
              expanding the project to see the sessions directly. */}
        </button>
        {!isGeneral && !renaming && (
          <>
            {/* + button — opens the central "Prepare a session" pane
                for this project. Customer drafts the problem (text,
                files, voice) BEFORE calling. When ready, they hit the
                phone button next door to ring the engineer who walks
                in with the prepared context. */}
            <button
              onClick={(e) => { e.stopPropagation(); onPrepareSession(group.key); }}
              title={`Prepare a new session in ${group.name}`}
              aria-label={`Prepare a new session in ${group.name}`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-raised)]"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={14} />
            </button>
            {/* Per-project call button. Color reflects engineer history:
                BLACK when the project has never had an engineer session
                (cold start — clicking triggers skill-match to find one);
                GREEN once at least one engineer has worked on this
                project (warm — the same engineer will be preferentially
                rung, or a picker shown when multiple engineers exist).
                Visual semantic: black = "find someone for this", green
                = "call the team that's helped you here". */}
            {(() => {
              const distinctEngineers = new Set<string>();
              for (const s of group.sessions) {
                if (s.agent) distinctEngineers.add(s.agent);
              }
              const isWarm = distinctEngineers.size > 0;
              const onlyName = distinctEngineers.size === 1
                ? Array.from(distinctEngineers)[0]
                : null;
              const buttonTitle = isWarm
                ? onlyName
                  ? `Connect with ${onlyName.split(" ")[0]} again`
                  : `Pick engineer for ${group.name} (${distinctEngineers.size} worked here)`
                : `Find an engineer for ${group.name}`;
              return (
                <button
                  onClick={(e) => { e.stopPropagation(); onStartInProject(group.key); }}
                  title={buttonTitle}
                  aria-label={buttonTitle}
                  className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                  style={{
                    backgroundColor: isWarm ? BRAND_GREEN : "#0a0a0a",
                    // Cold (black) button gets a thin white ring so it
                    // stays visible against the dark / espresso sidebar.
                    // The green button doesn't need it — green on dark
                    // already has plenty of contrast.
                    boxShadow: isWarm
                      ? undefined
                      : "inset 0 0 0 1px rgba(255, 255, 255, 0.45)",
                  }}
                >
                  <Phone size={11} strokeWidth={2.4} />
                </button>
              );
            })()}
            {/* Overflow menu — Rename + Delete actions. Delete opens
                a 2-factor confirmation modal at the RoomClient level
                (password + project name + literal "delete the project"
                phrase) before any destructive action runs. */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOverflowOpen((v) => !v);
                }}
                title={`More actions for ${group.name}`}
                aria-label={`More actions for ${group.name}`}
                className="ml-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-raised)]"
                style={{ color: "var(--text-muted)" }}
              >
                <MoreHorizontal size={14} />
              </button>
              {overflowOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-lg border shadow-xl"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOverflowOpen(false);
                      setDraftName(group.name);
                      setRenaming(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: "var(--text)" }}
                  >
                    <Pencil size={12} />
                    Rename project
                  </button>
                  {group.completionStatus === "active" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOverflowOpen(false);
                        onMarkProjectComplete(group.key, group.name);
                      }}
                      className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ color: "var(--text)", borderColor: "var(--border)" }}
                    >
                      <Check size={12} />
                      Mark complete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOverflowOpen(false);
                      onDeleteProject(group.key, group.name);
                    }}
                    className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-[12px] transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ color: "var(--accent-red)", borderColor: "var(--border)" }}
                  >
                    <X size={12} />
                    Delete project
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Session rows. Empty-project placeholder removed — a session is
          auto-created when the customer calls an engineer for the
          project (via the green phone button on the row), so we don't
          need a separate "start your first session" affordance inside
          the expanded folder.

          When the project has saved drafts, they render ABOVE the
          session rows with distinctive amber styling so the customer
          can tell at a glance "this isn't a real session yet — it's
          something I prepared." Clicking a draft re-opens the prep
          view loaded with that draft. */}
      {open && (
        <div className="ml-2 mt-0.5 space-y-0.5">
          {drafts.length > 0 && (
            <>
              {drafts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onPrepareSession(group.key, d.id)}
                  title={`Resume draft · last saved ${new Date(d.updatedAt).toLocaleString()}`}
                  className="flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--warn)_8%,transparent)]"
                  style={{
                    // Amber accent — same colour family the rest of the
                    // app uses for the Busy engineer state, intentional
                    // overlap (both mean "in flight, not yet committed").
                    // Dashed border keeps the "not a real session"
                    // visual at a glance.
                    borderColor: "color-mix(in srgb, var(--warn) 40%, transparent)",
                    borderStyle: "dashed",
                    backgroundColor: "color-mix(in srgb, var(--warn) 5%, transparent)",
                  }}
                >
                  <Pencil
                    size={12}
                    className="mt-0.5 shrink-0"
                    style={{ color: "var(--warn)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="rounded-full px-1 py-0 text-[8px] font-semibold uppercase tracking-wider"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--warn) 18%, transparent)",
                          color: "var(--warn)",
                        }}
                      >
                        Draft
                      </span>
                      <span
                        className="truncate text-[12px] font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {deriveDraftTitle(d)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                      Saved {fmtRelDate(new Date(d.updatedAt))}
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}
          {group.sessions.length === 0 && !isGeneral ? null : group.sessions
              // Sorting (pin-aware + date-desc) is applied upstream in
              // projectGroups so we can preserve it here.
              .map((s) => {
            const selected = viewingPastId === s.id;
            const isActive = !["ended", "abandoned", "cancelled"].includes(s.status);
            const isCurrent = isActive && s.id === currentSessionId;
            const isPinned = pinnedIds.has(s.id);
            return (
              // Session row container — relative so the pin button can
              // overlay the top-right corner of the row without affecting
              // the main button's hit target.
              <div key={s.id} className="relative group/session">
              <button
                onClick={() => onViewPast(isCurrent ? null : s.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 pr-7 text-left transition-all duration-150 ease-out hover:translate-x-0.5",
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

                {/* Pin toggle — overlays the top-right of the session row.
                    Pinned sessions show a filled icon always; unpinned ones
                    only reveal the outline icon on row hover. Click pins or
                    unpins; localStorage persists the choice. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(s.id);
                  }}
                  title={isPinned ? "Unpin session" : "Pin session"}
                  aria-label={isPinned ? "Unpin session" : "Pin session"}
                  aria-pressed={isPinned}
                  className={cn(
                    "absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md transition-all",
                    isPinned
                      ? "opacity-100"
                      : "opacity-0 group-hover/session:opacity-60 hover:opacity-100",
                  )}
                  style={{
                    color: isPinned ? BRAND_GREEN : "var(--text-muted)",
                  }}
                >
                  <Pin
                    size={11}
                    fill={isPinned ? BRAND_GREEN : "none"}
                    strokeWidth={isPinned ? 2 : 1.8}
                  />
                </button>
              </div>
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
  session, messages, onClose, currentUserId,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  onClose?: () => void;
  /** Forwarded into SummaryView for canEdit gating. */
  currentUserId: string | null;
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
        <SummaryView session={session} messages={messages} currentUserId={currentUserId} />
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

function SummaryView({
  session,
  messages,
  currentUserId,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  /**
   * Authenticated user id, when known. The server-side RPC
   * update_guest_call_summary enforces the actual permission check —
   * we only need this to decide whether to render the edit affordance.
   */
  currentUserId: string | null;
}) {
  const title = session.ai_summary_title;
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];
  const dur = session.duration_minutes != null ? Math.round(Number(session.duration_minutes)) : 0;
  // Customer or engineer of THIS session may edit the AI summary. Server
  // RPC enforces this again — the UI gate just avoids dangling pencils.
  const canEdit =
    !!currentUserId &&
    (currentUserId === session.customer_user_id || currentUserId === session.claimed_by);
  const handleSummarySave = useCallback(
    async (patch: { title?: string | null; overview?: string | null; nextSteps?: string[] }) => {
      const sb = createClient();
      // Pass NULL (= keep existing) for any field the patch didn't include.
      const { error } = await sb.rpc("update_guest_call_summary", {
        _call_id: session.id,
        _title: patch.title === undefined ? null : patch.title ?? "",
        _overview: patch.overview === undefined ? null : patch.overview ?? "",
        _next_steps: patch.nextSteps === undefined ? null : patch.nextSteps,
      });
      if (error) throw new Error(error.message);
    },
    [session.id],
  );
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
          {/* Title + overview + next-steps — all three inline-editable for
              the customer/engineer who own this session. Read-only for
              everyone else (supervisor view, etc). */}
          <EditableSummary
            title={title}
            overview={overview}
            nextSteps={nextSteps}
            canEdit={canEdit}
            onSave={handleSummarySave}
          />
          {zoomCompanionMessages.length > 0 && (
            <div className="pt-2">
              <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Zoom call summaries
              </h3>
              <div className="space-y-3">
                {zoomCompanionMessages.map((m) => (
                  <MeetingSummaryEntry
                    key={m.id}
                    body={m.body ?? ""}
                    canEdit={canEdit}
                    onEdit={async (newBody) => {
                      const sb = createClient();
                      const { error } = await sb.rpc("update_guest_message_body", {
                        _id: m.id, _body: newBody,
                      });
                      if (error) throw new Error(error.message);
                    }}
                    onDelete={async () => {
                      const sb = createClient();
                      const { error } = await sb.rpc("delete_guest_message", { _id: m.id });
                      if (error) throw new Error(error.message);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Session artifacts — files exchanged, AI summary, and chat
              transcript. The 90-day retention window starts when the
              project is marked completed; until then files persist
              indefinitely. SessionDownloads renders the retention copy
              from the project row it loads internally. canEdit on the
              session participants surfaces the per-file delete trash icon. */}
          <SessionDownloads session={session} messages={messages} canRemove={canEdit} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SessionDownloads — bottom-of-summary section listing all files exchanged
// during the session + downloadable AI summary + downloadable chat
// transcript.
//
// Retention:
//   • Project is 'active'    → files persist indefinitely.
//   • Project is 'completed' → 90-day countdown; files purgeable any day
//                              after completed_at + 90d.
//   • Project is 'archived'  → files already purged; we render a
//                              placeholder explaining when they expired.
//
// AI summary + chat transcript are generated client-side on click — no
// server round-trip. Both fall back to "—" gracefully when the data
// isn't populated (e.g. summary still generating).
// ──────────────────────────────────────────────────────────────────────────
function SessionDownloads({
  session,
  messages,
  canRemove = false,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  /** When true, each Files-exchanged row shows a hover trash icon that
   *  calls purge_guest_message_attachment. Gated by SummaryView to the
   *  session's customer or assigned engineer. */
  canRemove?: boolean;
}) {
  // Project status fetch — drives the retention copy. Lazy: only fires
  // when the section renders (already inside an "ended" branch). The
  // project_id can be null for sessions created before Phase 4 — those
  // get the "active" treatment (no retention copy).
  type ProjectStatus = {
    completion_status: "active" | "completed" | "archived";
    completed_at: string | null;
  } | null;
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>(null);

  useEffect(() => {
    if (!session.project_id) {
      setProjectStatus(null);
      return;
    }
    const sb = createClient();
    let alive = true;
    void (async () => {
      const { data } = await sb
        .from("projects")
        .select("completion_status, completed_at")
        .eq("id", session.project_id)
        .maybeSingle();
      if (!alive) return;
      setProjectStatus((data as ProjectStatus) ?? null);
    })();
    return () => { alive = false; };
  }, [session.project_id]);

  // Pull every attachment from this session's messages into one flat list.
  // We dedupe by id because supabase joins can occasionally yield the same
  // row twice when the message-side join expands.
  const attachments = useMemo(() => {
    const seen = new Set<string>();
    const out: GuestMessageAttachment[] = [];
    for (const m of messages) {
      if (!m.attachments) continue;
      for (const a of m.attachments) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        out.push(a);
      }
    }
    return out;
  }, [messages]);

  // Compute retention copy. "Available through {date}" once the project
  // is completed; "Available while project is active" otherwise.
  const retentionLine = useMemo(() => {
    if (!projectStatus) return null;
    if (projectStatus.completion_status === "archived") {
      return {
        tone: "muted" as const,
        text: "Files have been removed (90 days after project completion).",
      };
    }
    if (projectStatus.completion_status === "completed" && projectStatus.completed_at) {
      const expiry = new Date(projectStatus.completed_at);
      expiry.setDate(expiry.getDate() + 90);
      return {
        tone: "warn" as const,
        text: `Available through ${expiry.toLocaleDateString("en-US", {
          year: "numeric", month: "short", day: "numeric",
        })} · 90 days after project completion.`,
      };
    }
    return {
      tone: "muted" as const,
      text: "Files stay available while this project is active.",
    };
  }, [projectStatus]);

  const downloadText = useCallback((filename: string, body: string) => {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const summaryText = useMemo(() => {
    const parts: string[] = [];
    if (session.ai_summary_title) parts.push(session.ai_summary_title);
    if (session.ai_summary_title) parts.push("");
    const overview = session.ai_summary_overview ?? session.summary;
    if (overview) {
      parts.push(overview);
      parts.push("");
    }
    const steps = Array.isArray(session.ai_next_steps as unknown)
      ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
      : [];
    if (steps.length > 0) {
      parts.push("Next steps:");
      for (const s of steps) {
        const t = typeof s === "string" ? s : (s.text ?? s.description ?? "");
        if (t) parts.push(`- ${t}`);
      }
      parts.push("");
    }
    if (session.duration_minutes != null) {
      parts.push(`Session duration: ${Math.round(Number(session.duration_minutes))} min`);
    }
    parts.push(`Session id: ${session.id}`);
    parts.push(`Generated: ${new Date().toISOString()}`);
    return parts.join("\n").trim() + "\n";
  }, [session]);

  const transcriptText = useMemo(() => {
    const lines: string[] = [];
    lines.push(`Relay session transcript — ${session.id}`);
    lines.push(`Generated ${new Date().toISOString()}`);
    lines.push("");
    for (const m of messages) {
      if (m.sender_kind === "system") {
        // Skip Zoom AI summary system messages — they live in their own
        // download. System lines are still informative (joined/left,
        // recording link) so we keep them with a [system] tag.
        if (m.body && isAiSummaryMessageBody(m.body)) continue;
        const ts = new Date(m.created_at).toISOString();
        lines.push(`[${ts}] [system] ${m.body ?? ""}`);
        continue;
      }
      const who = m.sender_name ?? (m.sender_kind === "guest" ? "Customer" : "Engineer");
      const ts = new Date(m.created_at).toISOString();
      lines.push(`[${ts}] ${who}: ${m.body ?? ""}`);
      if (m.attachments && m.attachments.length > 0) {
        for (const a of m.attachments) {
          lines.push(`    — ${a.kind}: ${a.name} (${a.mime}, ${a.size_bytes} bytes)`);
        }
      }
    }
    return lines.join("\n") + "\n";
  }, [session, messages]);

  const summaryFilename = `relay-session-${session.id.slice(0, 8)}-summary.txt`;
  const transcriptFilename = `relay-session-${session.id.slice(0, 8)}-transcript.txt`;

  return (
    <div className="pt-2">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Files &amp; downloads
      </h3>

      {/* Two-up download buttons for the generated artifacts. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DownloadButton
          label="AI summary"
          sub=".txt · generated"
          onClick={() => downloadText(summaryFilename, summaryText)}
          disabled={projectStatus?.completion_status === "archived"}
        />
        <DownloadButton
          label="Chat transcript"
          sub=".txt · all messages"
          onClick={() => downloadText(transcriptFilename, transcriptText)}
          disabled={projectStatus?.completion_status === "archived"}
        />
      </div>

      {/* File attachments grouped under "Files exchanged". Purged rows
          show as a stripped placeholder so the visual continuity stays
          even after retention. */}
      <div className="mt-4">
        <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-faint)" }}>
          Files exchanged
        </div>
        {attachments.length === 0 ? (
          <p className="px-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            No files were shared in this session.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {attachments.map((a) => (
              <SessionAttachmentRow
                key={a.id}
                attachment={a}
                archived={projectStatus?.completion_status === "archived"}
                canRemove={canRemove}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Retention copy — bottom of section so it grounds the whole
          downloads block in policy. Tone tracks the project status. */}
      {retentionLine && (
        <div
          className="mt-4 rounded-lg border px-3 py-2 text-[11px]"
          style={{
            borderColor: retentionLine.tone === "warn"
              ? "color-mix(in srgb, var(--warn) 30%, transparent)"
              : "var(--border)",
            backgroundColor: retentionLine.tone === "warn"
              ? "color-mix(in srgb, var(--warn) 8%, transparent)"
              : "var(--surface-raised)",
            color: retentionLine.tone === "warn" ? "var(--warn)" : "var(--text-muted)",
          }}
        >
          {retentionLine.text}
        </div>
      )}
    </div>
  );
}

function DownloadButton({
  label, sub, onClick, disabled,
}: {
  label: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <FileText size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium" style={{ color: "var(--text)" }}>{label}</div>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{sub}</div>
      </div>
    </button>
  );
}

// One row in the "Files exchanged" list. Active rows fetch a signed
// download URL on click; archived rows show a "removed after retention"
// note. We don't pre-fetch URLs en-masse — only at click time — because
// the session summary can have many attachments and minting N signed
// URLs upfront wastes API calls.
//
// canRemove gates the hover-revealed trash icon. Removing a file calls
// purge_guest_message_attachment which flips purged=true; the row keeps
// its slot but switches to the "Removed" placeholder — same UI branch
// the 90-day retention sweeper triggers. We don't hard-delete because
// the position in the history matters ("there used to be a file here").
function SessionAttachmentRow({
  attachment,
  archived,
  canRemove = false,
}: {
  attachment: GuestMessageAttachment;
  archived: boolean;
  canRemove?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Mirror the server's purged flag locally so removing this row
  // feels instant — the realtime sub then confirms.
  const [optimisticPurged, setOptimisticPurged] = useState(false);
  const isPurged = attachment.purged === true || archived || optimisticPurged;

  const onClick = async () => {
    if (isPurged || busy) return;
    setBusy(true);
    try {
      const sb = createClient();
      const url = await signedDownloadUrl(sb, attachment.path, attachment.name);
      if (url) window.location.href = url;
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (isPurged || removing) return;
    if (typeof window !== "undefined" && !window.confirm("Remove this file from the session view?")) {
      return;
    }
    setRemoving(true);
    try {
      const sb = createClient();
      const { error } = await sb.rpc("purge_guest_message_attachment", { _id: attachment.id });
      if (error) throw new Error(error.message);
      setOptimisticPurged(true);
    } catch {
      // Best-effort — leave the row visible if the RPC fails so the
      // customer/engineer can retry. No toast yet; this is an edge case.
    } finally {
      setRemoving(false);
    }
  };

  const Icon = attachment.kind === "image" ? FileText
    : attachment.kind === "audio" ? Music
    : FileText;

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={isPurged || busy}
        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:cursor-not-allowed ${canRemove && !isPurged ? "pr-10" : ""}`}
        style={{
          borderColor: "var(--border)",
          backgroundColor: isPurged
            ? "color-mix(in srgb, var(--surface-raised) 40%, transparent)"
            : "var(--surface)",
          opacity: isPurged ? 0.6 : 1,
        }}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor: isPurged
              ? "color-mix(in srgb, var(--text) 5%, transparent)"
              : BRAND_GREEN_SOFT,
            color: isPurged ? "var(--text-muted)" : BRAND_GREEN,
          }}
        >
          <Icon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium" style={{ color: "var(--text)" }}>
            {attachment.name}
          </div>
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {isPurged
              ? optimisticPurged
                ? "Removed from this session."
                : "Removed after 90-day retention window."
              : `${attachment.kind} · ${Math.round(attachment.size_bytes / 1024)} KB`}
          </div>
        </div>
        {!isPurged && !canRemove && (
          <Download size={14} style={{ color: "var(--text-muted)" }} />
        )}
      </button>
      {canRemove && !isPurged && (
        <button
          type="button"
          onClick={() => void onRemove()}
          disabled={removing}
          aria-label={`Remove ${attachment.name}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 dark:hover:bg-white/10"
          style={{ color: "var(--text-muted)" }}
        >
          {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        </button>
      )}
    </li>
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

  // Elapsed shown as mm:ss counting up — honest waiting clock instead
  // of the old draining countdown ring. The 90s anchor is still used
  // by `expired` to surface the "Call again" CTA, but the UI just
  // shows how long you've been waiting.
  const eMin = Math.floor(elapsed / 60);
  const eSec = elapsed % 60;
  const elapsedClock = `${String(eMin).padStart(2, "0")}:${String(eSec).padStart(2, "0")}`;

  const ringColor = session.urgency === "critical" ? CRIT_RED
    : session.urgency === "urgent" ? URGENT_AMBER
    : BRAND_GREEN;
  const ringSoft = session.urgency === "critical" ? CRIT_RED_SOFT
    : session.urgency === "urgent" ? URGENT_AMBER_SOFT
    : BRAND_GREEN_SOFT;

  // Play the warm "tring tring" mechanical bell while the modal is
  // open + not minimized + not expired. Shared synthesis with the
  // full-page ringing screen (lib/relay/useRingtone.ts) so both
  // surfaces sound identical.
  useRingtone(!minimized && !expired);

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

        {/* Ringing hero — pulsing green ball + expanding halo rings +
            soft under-glow, same visual register as the full-page
            ringing screen (app/intake/matching/[id]/MatchingClient.tsx
            → RingingHero). Sized down (~140px ball) to fit the modal.
            Color follows urgency: green normal / amber urgent / red
            critical. Animations are gated behind the existing
            prefers-reduced-motion query in globals.css. */}
        <div className="mb-5 flex justify-center">
          <div
            className="relative flex items-center justify-center"
            style={{ width: 200, height: 200, ["--primary" as string]: ringColor }}
          >
            {/* Halo rings — 3 concentric, staggered. */}
            <span aria-hidden className="relay-ringing-halo absolute inset-0 rounded-full" style={{ animationDelay: "0s" }} />
            <span aria-hidden className="relay-ringing-halo absolute inset-0 rounded-full" style={{ animationDelay: "-0.6s" }} />
            <span aria-hidden className="relay-ringing-halo absolute inset-0 rounded-full" style={{ animationDelay: "-1.2s" }} />

            {/* Under-glow — blurred radial behind the ball. */}
            <span
              aria-hidden
              className="absolute rounded-full"
              style={{
                width: 160,
                height: 160,
                background: `radial-gradient(circle, color-mix(in srgb, ${ringColor} 55%, transparent) 0%, transparent 70%)`,
                filter: "blur(16px)",
              }}
            />

            {/* The ball. Heartbeat scale + radial gradient give it
                weight + a "lit from within" feel. Phone icon centered. */}
            <div
              className="relay-ringing-ball relative flex items-center justify-center rounded-full"
              style={{
                width: 140,
                height: 140,
                background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${ringColor} 90%, white) 0%, ${ringColor} 55%, color-mix(in srgb, ${ringColor} 65%, #000) 100%)`,
                boxShadow:
                  `0 16px 36px color-mix(in srgb, ${ringColor} 32%, transparent), ` +
                  `0 6px 12px color-mix(in srgb, ${ringColor} 22%, transparent), ` +
                  `inset 0 -8px 16px rgba(0, 0, 0, 0.22), ` +
                  `inset 0 8px 16px rgba(255, 255, 255, 0.14)`,
                opacity: expired ? 0.55 : 1,
              }}
            >
              <Phone size={48} className="relay-ringing-icon" style={{ color: "#fff" }} strokeWidth={1.6} />
            </div>
          </div>
        </div>

        {/* Elapsed clock — counts up from the moment the call started.
            Honest "you've been waiting this long" instead of the old
            countdown-to-expiry. */}
        <div className="mb-4 text-center">
          <div
            className="font-mono text-2xl tabular-nums tracking-[0.05em]"
            style={{
              color: expired ? "var(--text-muted)" : "var(--text)",
              fontFeatureSettings: '"tnum"',
            }}
            aria-live="polite"
          >
            {elapsedClock}
          </div>
        </div>

        {/* Heading + subtitle — flips when the 90s window has elapsed
            so the customer knows we're still trying and can recall. */}
        <div className="mb-5 text-center">
          <h2 className="mb-1.5 text-xl font-medium"
            style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)" }}>
            {expired ? "Still searching…" : "Ringing your engineer"}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {expired
              ? "No one's picked up just yet. Try calling again — we'll page the next available engineer."
              : "Hang tight — we'll connect you the moment someone picks up."}
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
