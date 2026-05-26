"use client";

/*
 * Engineer session room — mirrors the customer /room layout.
 *
 * Layout (state-driven):
 *   - Sidebar (260px): customer card + customer's past sessions + engineer profile
 *   - Main area:
 *       not-yet-live  → chat full width   (top-right: "Start video" + End)
 *       live          → Zoom (centre)  |  chat (right)
 *       ended         → chat (centre, locked)  |  summary + chat-history (right, pill tabs)
 *
 * No global nav inside the room. After end_session → redirect to /inbox
 * (the post-call landing screen with recent calls + take-next).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PanelGroup, Panel, PanelResizeHandle,
} from "react-resizable-panels";
import {
  Send, Video, PhoneOff, Loader2, ArrowLeft, RotateCw, Sparkles, Lock, Eye, LogOut,
  PanelLeftOpen, PanelLeftClose, AlertTriangle, BookOpen, ChevronRight, Check,
  Download,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { MeetingChatEntry } from "@/app/_components/MeetingChatEntry";
import { MeetingSummaryEntry, isAiSummaryMessageBody } from "@/app/_components/MeetingSummaryEntry";
import { ChatComposer } from "@/app/_components/ChatComposer";
import { EngineerAiAsk } from "@/app/_components/EngineerAiAsk";
import { MessageAttachments } from "@/app/_components/MessageAttachments";
import { EditableSummary } from "@/app/_components/EditableSummary";
import { createClient } from "@/lib/supabase/browser";
import { useEngineerSession } from "@/lib/relay/useEngineerSession";
import { useIsSupervisor, isSupervisorOnlyMessage } from "@/lib/relay/useIsSupervisor";
import { useSessionTimer } from "@/lib/relay/useSessionTimer";
import { humanState } from "@/lib/relay/session-status";
import { LaunchCallProvider, isVideoSdkEnabled } from "@/lib/video/LaunchCallContext";
import { CallSurface } from "@/app/_components/call/CallSurface";
import type { GuestCall, GuestMessage, SessionStatus, Urgency } from "@/lib/supabase/types";

const BRAND_GREEN        = "#3f5c2e";
const BRAND_GREEN_SOFT   = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";
const URGENT_AMBER       = "#d4a017";
const URGENT_AMBER_SOFT  = "rgba(212, 160, 23, 0.14)";
const CRIT_RED           = "#8b1a1a";
const CRIT_RED_SOFT      = "rgba(139, 26, 26, 0.18)";

// ── Main entry ─────────────────────────────────────────────────────────────
export function EngineerSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const state  = useEngineerSession(sessionId);
  // Anchor the engineer's elapsed-time display on assigned_at — when they
  // accepted and the session/chat began. Matches the customer view and the
  // server billing anchor; independent of the Zoom call.
  const timer  = useSessionTimer(state.session?.assigned_at ?? state.session?.joined_at ?? null, state.session?.free_minutes ?? 10);
  const [meEmail, setMeEmail] = useState<string>("");
  // Viewer role gate. Anyone the useIsSupervisor hook recognises as a
  // supervisor-tier viewer (supervisor / super_admin per the new taxonomy)
  // is locked into read-only monitor chrome — they retain Supervisor
  // permissions and never get engineer controls, even on sessions claimed
  // by another engineer that they're inspecting.
  const isSupervisor = useIsSupervisor();

  // Drives whether the Zoom embed is mounted. We auto-mount the embed as
  // soon as the engineer lands on the session room (status=assigned/joining)
  // — they don't have to click "Start video". mark_joined("engineer") fires
  // ONLY when the embed's onJoined callback runs, so the customer is told
  // "engineer is calling" only when the engineer is genuinely in the Zoom
  // meeting (not just at the door).
  const [started, setStarted] = useState(false);
  const [autoMinting, setAutoMinting] = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);

  // Video SDK in-window call surface — gated by NEXT_PUBLIC_USE_VIDEO_SDK.
  // When the flag is set, the engineer's Zoom join path becomes the
  // in-window <CallSurface> instead of the Meeting SDK embed.
  const [callOpen, setCallOpen] = useState(false);
  // Timestamp of the most recent voluntary close. Used to gate the
  // auto-mount effect — without it, leaving the call would re-mount the
  // surface ~1 s later (engineer_joined_at gets cleared by
  // zoom-video-sdk-end so the auto-mount guard reactivates). With it,
  // we only re-auto-mount when a NEW "Zoom meeting started" arrives
  // (i.e. customer or someone else restarted the call).
  const [autoMountSuppressedUntilNewCycle, setAutoMountSuppressedUntilNewCycle] = useState(false);
  const launchCall: (() => void) | null = isVideoSdkEnabled()
    ? () => {
        setAutoMountSuppressedUntilNewCycle(false);
        setCallOpen(true);
      }
    : null;
  useEffect(() => {
    if (state.session?.status === "ended") setCallOpen(false);
  }, [state.session?.status]);

  // Whenever a NEW "Zoom meeting started" lands AFTER our dismissal, drop
  // the suppression so the auto-mount can fire again. Indexed by the
  // newest started message's id so we don't loop on the same one.
  const lastStartedSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoMountSuppressedUntilNewCycle) return;
    const latestStarted = state.messages
      .filter((m) => m.sender_kind === "system" && (m.body ?? "").includes("Zoom meeting started"))
      .pop();
    if (latestStarted && latestStarted.id !== lastStartedSeenRef.current) {
      lastStartedSeenRef.current = latestStarted.id;
      setAutoMountSuppressedUntilNewCycle(false);
    }
  }, [state.messages, autoMountSuppressedUntilNewCycle]);

  // Video SDK auto-start: mirror the legacy auto-mint behaviour. When the
  // engineer lands on a pre-live or live session, automatically mount the
  // CallSurface — which calls zoom-video-sdk-token, which posts the
  // "Zoom meeting started" system message so the customer's chat card
  // appears with a Join button.
  useEffect(() => {
    if (!isVideoSdkEnabled()) return;
    if (!state.session) return;
    if (!state.isAssignedEngineer) return;
    if (isSupervisor) return;
    if (callOpen) return;
    if (autoMountSuppressedUntilNewCycle) return;
    if (!["assigned", "joining", "live", "grace"].includes(state.session.status)) return;
    // Only auto-mount if the engineer hasn't already joined this cycle;
    // engineer_joined_at is cleared by zoom-video-sdk-end so the next cycle
    // starts fresh.
    if (state.session.engineer_joined_at) return;
    setCallOpen(true);
  }, [state.session, state.isAssignedEngineer, isSupervisor, callOpen, autoMountSuppressedUntilNewCycle]);

  // Reset 'started' when session changes or ends
  useEffect(() => {
    if (state.session?.status === "ended" || state.session?.status === "queued") {
      setStarted(false);
    }
  }, [state.session?.id, state.session?.status]);

  // ── Customer-prep handoff ───────────────────────────────────────────────
  // When the engineer lands on the session room, look up the customer's
  // most-recent saved draft for this session's project and post its text
  // as the opening chat message. The server-side mirror in
  // customer_session_drafts lets us bridge across browsers — the customer
  // wrote it in their localStorage, we mirrored it on save, and now we
  // pull it back via the engineer_fetch_customer_draft RPC.
  //
  // Once-per-session guard: a ref keyed by session id prevents re-renders
  // from posting the prep text twice. We also call engineer_consume_draft
  // so the next session on the same project doesn't see stale prep text.
  const prepHandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const s = state.session;
    if (!s || !state.isAssignedEngineer || isSupervisor) return;
    if (!["assigned", "joining", "live"].includes(s.status)) return;
    if (prepHandedRef.current.has(s.id)) return;
    if (!s.project_id) return;
    prepHandedRef.current.add(s.id);
    let cancelled = false;
    void (async () => {
      try {
        const sb = createClient();
        const { data, error } = await sb.rpc("engineer_fetch_customer_draft", { _session_id: s.id });
        if (cancelled || error || !data) return;
        const draft = data as { id: string; text: string | null; customer_user_id: string };
        const text = (draft.text ?? "").trim();
        if (!text) return;
        // System prelude lets the engineer see "this is prep, not a live
        // message" at a glance.
        await sb.from("guest_messages").insert([
          {
            guest_call_id: s.id,
            sender_kind: "system",
            sender_name: "Relay",
            body: "💡 Customer prepared this before the call:",
          },
          {
            guest_call_id: s.id,
            sender_kind: "guest",
            sender_name: s.guest_name ?? "Customer",
            body: text,
          },
        ]);
        // Consume the draft on the server so the next engineer joining
        // this project doesn't re-replay it as opening prep.
        await sb.rpc("engineer_consume_draft", { _draft_id: draft.id });
        await state.refresh();
      } catch {
        /* best-effort handoff; chat still works without it */
      }
    })();
    return () => { cancelled = true; };
  }, [state.session?.id, state.session?.status, state.isAssignedEngineer, isSupervisor, state]);

  // Auto-start: mint Zoom (if needed) and mount the embed whenever the
  // engineer is pre-live (assigned/joining/grace). Idempotent — re-entries
  // and reloads do the right thing. Skipped entirely for non-engineer
  // viewers (supervisors are read-only monitors).
  // VIDEO SDK: when NEXT_PUBLIC_USE_VIDEO_SDK is on we DON'T auto-mint a
  // Zoom Meeting — the Video SDK CallSurface uses zoom-video-sdk-token
  // instead. Auto-mint would post an orphaned "Zoom meeting started" card
  // that nobody actually joined (via Meeting SDK), so the engineer's chat
  // would show a stale ongoing card while the real Video SDK call runs.
  useEffect(() => {
    const s = state.session;
    if (!s) return;
    if (!state.isAssignedEngineer) return;
    if (isSupervisor) return;  // supervisors never auto-mint Zoom
    if (isVideoSdkEnabled()) return;  // Video SDK owns the call surface
    if (!["assigned", "joining", "grace"].includes(s.status)) return;
    if (started || autoMinting) return;

    let cancelled = false;
    void (async () => {
      setAutoMinting(true);
      setAutoStartError(null);
      try {
        const sb = createClient();
        if (!s.zoom_meeting_id) {
          const { data, error } = await sb.functions.invoke("mint-zoom-for-session", {
            body: { session_id: s.id },
          });
          if (cancelled) return;
          if (error || !data?.zoom_meeting_id) {
            const msg = error?.message ?? (data?.error as string | undefined) ?? "Couldn't mint Zoom meeting";
            setAutoStartError(msg);
            setTimeout(() => setAutoStartError(null), 6000);
            return;
          }
        }
        if (!cancelled) setStarted(true);
      } finally {
        if (!cancelled) setAutoMinting(false);
      }
    })();

    return () => { cancelled = true; };
  }, [state.session?.id, state.session?.status, state.session?.zoom_meeting_id, started, autoMinting]);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => {
      if (data.user?.email) setMeEmail(data.user.email);
    }, (e) => {
      // Transient network blip / sleep/wake — recoverable on next render.
      console.warn("[eng-session] getUser failed:", e instanceof Error ? e.message : String(e));
    });
  }, []);

  // Redirect to /inbox after end — that's the dedicated post-call landing.
  // (3-second beat gives the summary edge fn time to write the AI summary
  // before the engineer leaves the page.)
  const prevStatusRef = useRef<SessionStatus | null>(null);
  useEffect(() => {
    if (state.session?.status === "ended" && prevStatusRef.current && prevStatusRef.current !== "ended") {
      const t = setTimeout(() => router.push("/inbox"), 3000);
      return () => clearTimeout(t);
    }
    prevStatusRef.current = state.session?.status ?? null;
  }, [state.session?.status, router]);

  // Desktop-shell integration: hide the floating orb widget while a Relay
  // session is in flight on the engineer side. Bridge is no-op in the
  // plain browser (window.relay is undefined). Used to live in
  // PopOutContainer; that mounted with the Zoom embed, which we no longer
  // use, so we drive the signal from the session status directly.
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

  // Payment-buffer watchdog: if the customer hasn't paid within 10 min of
  // expired_free, auto-end. Idempotent (end_session is a no-op on terminal
  // states), so customer-side firing the same call is harmless. Skipped for
  // supervisor monitors — end_session would 403 (not the assigned engineer
  // / not the customer) and we don't want supervisors firing session-end
  // calls from their tab regardless.
  const sess = state.session;
  useEffect(() => {
    if (isSupervisor) return;
    if (sess?.status !== "expired_free" || !sess.free_expired_at) return;
    const elapsedMs = Date.now() - new Date(sess.free_expired_at).getTime();
    const remainingMs = 10 * 60_000 - elapsedMs;
    if (remainingMs <= 0) {
      void state.end("payment_buffer_expired");
      return;
    }
    const t = setTimeout(() => void state.end("payment_buffer_expired"), remainingMs);
    return () => clearTimeout(t);
  }, [sess?.status, sess?.free_expired_at, state, isSupervisor]);

  if (state.loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
        <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
      </div>
    );
  }

  if (!state.session) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center" style={{ color: "var(--text)" }}>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Session not found.</p>
        <button
          onClick={() => router.push("/inbox")}
          className="mt-4 text-sm underline"
          style={{ color: BRAND_GREEN }}
        >
          Back to inbox
        </button>
      </div>
    );
  }

  return (
    <LaunchCallProvider value={launchCall}>
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
    >
      <Sidebar engineerEmail={meEmail} session={state.session} timer={timer} isSupervisor={isSupervisor} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* In-window Video SDK call surface (feature-flagged). Engineer joins
            as host (role=1); end-for-all RPC fires on Leave. */}
        {callOpen && state.session && (
          <div className="absolute inset-0 z-20" style={{ background: "var(--background)" }}>
            <CallSurface
              sessionId={state.session.id}
              role="host"
              userName={meEmail || "Engineer"}
              onClose={() => {
                setCallOpen(false);
                // Suppress auto-mount until a NEW "Zoom meeting started"
                // arrives — otherwise the effect would re-fire immediately
                // because engineer_joined_at gets cleared on leave.
                setAutoMountSuppressedUntilNewCycle(true);
              }}
              onJoined={() => void state.markJoined()}
            />
          </div>
        )}
        {isSupervisor && (
          <div
            className="flex shrink-0 items-center justify-center gap-2 border-b px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{
              backgroundColor: "color-mix(in srgb, var(--text) 4%, transparent)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
          >
            <Eye size={11} />
            Supervisor view · read-only
          </div>
        )}
        {!isSupervisor && (
          <FloatingStatus
            state={state}
            timer={timer}
            started={started}
            onStart={() => setStarted(true)}
          />
        )}
        <main className="min-h-0 flex-1">
          <MainPane state={state} isSupervisor={isSupervisor} />
        </main>
      </div>

      {state.error
        && !state.error.includes("NOT_ASSIGNED_TO_YOU")
        && !state.error.includes("NOT_AUTHORIZED")
        && <ErrorToast message={state.error} />}
      {autoStartError && (
        <div
          className="pointer-events-auto fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-lg"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          Auto-start failed: {autoStartError} — tap the <span className="font-semibold">video button</span> next to Send to retry.
        </div>
      )}
    </div>
    </LaunchCallProvider>
  );
}

// ── Layout decider ─────────────────────────────────────────────────────────
function MainPane({
  state, isSupervisor,
}: {
  state: ReturnType<typeof useEngineerSession>;
  isSupervisor: boolean;
}) {
  const session = state.session!;
  const isEnded = session.status === "ended";
  // Supervisors are always read-only monitors — they retain Supervisor
  // permissions and never get engineer-side controls, even if claimed_by
  // happens to match (e.g. a supervisor who claimed this session). The
  // top-of-pane "Supervisor view · read-only" badge tells the viewer why.
  const isEngineer = state.isAssignedEngineer && !isSupervisor;

  // Post-call review — chat (locked) on the left, AI summary on the right.
  if (isEnded) {
    return (
      <PanelGroup direction="horizontal" autoSaveId="relay-eng-review" className="h-full">
        <Panel defaultSize={60} minSize={40} order={1}>
          <ChatPane state={state} fullWidth />
        </Panel>
        <Resizer />
        <Panel defaultSize={40} minSize={28} order={2}>
          <ReviewPanel
            session={session}
            messages={state.messages}
            currentUserId={state.viewerUserId}
          />
        </Panel>
      </PanelGroup>
    );
  }

  // Active session (assigned/joining/live/grace/expired_free). Chat full
  // width; the ZoomJoinCard renders inline at the top of the message stream
  // and the engineer can start a new Zoom from the icon button next to Send.
  return <ChatPane state={state} fullWidth readOnly={!isEngineer} />;
}

// ── Sidebar (customer card + past sessions + engineer profile) ─────────────
type PastSession = {
  id: string;
  title: string;
  agent: string | null;
  minutes: number | null;
  date: string;
};

function Sidebar({
  engineerEmail, session, timer, isSupervisor,
}: {
  engineerEmail: string;
  session: GuestCall;
  timer: ReturnType<typeof useSessionTimer>;
  isSupervisor: boolean;
}) {
  const router = useRouter();
  const [past, setPast] = useState<PastSession[]>([]);

  useEffect(() => {
    if (!session.thread_id) return;
    const sb = createClient();
    void (async () => {
      const { data } = await sb
        .from("guest_calls")
        .select("id, agent_name, duration_minutes, ai_summary_title, created_at, status")
        .eq("thread_id", session.thread_id!)
        .eq("status", "ended")
        .neq("id", session.id)
        .order("created_at", { ascending: false })
        .limit(20);
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
  }, [session.thread_id, session.id]);

  const buckets = useMemo(() => groupByDate(past), [past]);

  // Collapsed: 60px icon rail with toggle / customer avatar / status dot /
  //            engineer avatar. Expanded: full 260px panel.
  // Default open since the engineer actively uses customer history during
  // a call; collapse is for when they want more room for the Zoom video.
  const [collapsed, setCollapsed] = useState(false);

  // ── Collapsed rail ──────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="flex h-full w-14 shrink-0 flex-col items-center gap-1 py-2"
        style={{ borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
      >
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelLeftOpen size={18} />
        </button>

        <Link
          href="/inbox"
          title="Back to inbox"
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={16} />
        </Link>

        {/* Customer avatar (initial) */}
        <div
          title={session.guest_name ?? "Customer"}
          className="mt-1 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold uppercase"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          {(session.guest_name || "?")[0]}
        </div>

        {/* Active-session pulse — shows from claim onwards (chat counts) */}
        {(["assigned","joining","live","grace","expired_free"] as SessionStatus[]).includes(session.status) && (
          <span
            title={`Session · ${timer.format}`}
            className="mt-1 flex h-9 w-9 items-center justify-center"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span
                className="absolute inset-0 rounded-full opacity-60"
                style={{ backgroundColor: BRAND_GREEN, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }}
              />
              <span className="relative h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
            </span>
          </span>
        )}

        <div className="flex-1" />

        {/* Engineer avatar at bottom */}
        <div
          title={`${engineerEmail.split("@")[0] || "Engineer"} · Engineer · on call`}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {(engineerEmail || "?")[0]}
        </div>
      </aside>
    );
  }

  // ── Expanded sidebar (260 px) ───────────────────────────────────────────
  return (
    <aside
      className="flex h-full w-[260px] shrink-0 flex-col"
      style={{ borderRight: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Brand + back-to-inbox + collapse toggle */}
      <div className="flex h-12 items-center justify-between gap-1 px-3">
        <Wordmark size="md" />
        <div className="flex items-center gap-1">
          <Link
            href="/inbox"
            className="rounded-md p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            title="Back to inbox"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} />
          </Link>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            className="rounded-md p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>

      {/* Customer card */}
      <div className="px-3 pb-3 pt-1">
        <div
          className="flex items-center gap-3 rounded-lg border p-3"
          style={{ borderColor: "var(--border)", backgroundColor: "color-mix(in srgb, var(--text) 2%, transparent)" }}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
          >
            {(session.guest_name || "?")[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
              {session.guest_name}
            </div>
            <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
              {session.guest_email}
            </div>
          </div>
        </div>
      </div>

      {/* Current session pill */}
      <div className="px-2">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Current
        </div>
        <div
          className="flex items-center gap-2 rounded-md px-2.5 py-2"
          style={{ backgroundColor: BRAND_GREEN_SOFT, border: `1px solid ${BRAND_GREEN_BORDER}` }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 rounded-full opacity-70"
              style={{ backgroundColor: BRAND_GREEN, animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite" }} />
            <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
              {humanState(session.status)}
            </div>
            <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
              {(["assigned","joining","live","grace","expired_free"] as SessionStatus[]).includes(session.status)
                ? `${humanState(session.status)} · ${timer.format}`
                : "In session"}
            </div>
          </div>
        </div>
      </div>

      {/* Past sessions for this customer */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 pt-3">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          History with {session.guest_name?.split(" ")[0] ?? "this customer"}
        </div>
        {past.length === 0 ? (
          <p className="px-2 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            First session with this customer.
          </p>
        ) : (
          buckets.map(([label, items]) => items.length === 0 ? null : (
            <div key={label} className="mt-3">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {label}
              </div>
              {items.map((s) => {
                const isCurrent = s.id === session.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { if (!isCurrent) router.push(`/staff/session/${s.id}`); }}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${isCurrent ? "bg-black/5 dark:bg-white/5" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--text-muted)" }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: "var(--text)" }}>{s.title}</div>
                      <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {s.agent ?? "Engineer"}{s.minutes != null ? ` · ${s.minutes}m` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}

        {/* Project memory — every session ever run on this project, regardless
            of which engineer or thread. Collapsed by default per the engineer-
            parity spec; expand when the engineer needs the full project
            chronology with AI summaries to ground the current session. */}
        {session.project_id && (
          <ProjectMemorySection
            projectId={session.project_id}
            projectName={session.project_name ?? null}
            currentSessionId={session.id}
            onOpen={(id) => router.push(`/staff/session/${id}`)}
          />
        )}
      </div>

      {/* Viewer profile — engineer chrome or supervisor monitor chrome */}
      <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {(engineerEmail || "?")[0]}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-[12px] font-medium" style={{ color: "var(--text)" }}>
              {engineerEmail.split("@")[0] || (isSupervisor ? "Supervisor" : "Engineer")}
            </div>
            <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
              {isSupervisor ? "Supervisor · monitoring" : "Engineer · on call"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Floating top-right controls ────────────────────────────────────────────
function FloatingStatus({
  state, timer, started, onStart,
}: {
  state: ReturnType<typeof useEngineerSession>;
  timer: ReturnType<typeof useSessionTimer>;
  started: boolean;
  onStart: () => void;
}) {
  const session = state.session!;
  const [busyStart, setBusyStart] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  const isPreLive = ["assigned", "joining", "grace"].includes(session.status);
  const isLive    = session.status === "live";
  const isEnded   = session.status === "ended";
  const isExpiredFree = session.status === "expired_free";
  // Timer-active = anything where the chat-inclusive 10-min clock is running.
  // Wider than isLive so the engineer sees the count from claim onwards.
  const isTimerActive = isPreLive || isLive || isExpiredFree;
  const hasMeeting = !!session.zoom_meeting_id;
  const inCall = started || isLive;

  // Buffer countdown when customer is paying
  const [, force] = useState(0);
  useEffect(() => {
    if (!isExpiredFree) return;
    const id = setInterval(() => force((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isExpiredFree]);

  let bufferRemainingLabel = "";
  if (isExpiredFree && session.free_expired_at) {
    const remMs = 10 * 60_000 - (Date.now() - new Date(session.free_expired_at).getTime());
    const remSec = Math.max(0, Math.floor(remMs / 1000));
    bufferRemainingLabel = `${String(Math.floor(remSec / 60)).padStart(2, "0")}:${String(remSec % 60).padStart(2, "0")}`;
  }

  // Engineer "Start video":
  //   1. Mint the Zoom meeting (if not already present).
  //   2. Mark engineer joined NOW — this notifies the customer (their
  //      IncomingCallModal pops) regardless of how long the SDK takes.
  //   3. Flip the local 'started' flag so the embed mounts and tries to
  //      join in parallel. If it succeeds → engineer is on video in-app.
  //      If it stalls/fails → engineer uses the "Open in Zoom directly"
  //      fallback link without leaving the customer in the dark.
  // Manual retry path (auto-start handles the happy case). We deliberately
  // do NOT call mark_joined here — it must fire only when the embed's
  // onJoined callback runs, so the customer is only "called" once the
  // engineer is actually in the Zoom meeting.
  const startVideo = async () => {
    setBusyStart(true);
    setMintError(null);
    try {
      const sb = createClient();
      if (!hasMeeting) {
        const { data, error } = await sb.functions.invoke("mint-zoom-for-session", {
          body: { session_id: session.id },
        });
        if (error || !data?.zoom_meeting_id) {
          const msg = error?.message ?? (data?.error as string | undefined) ?? "Couldn't mint Zoom meeting";
          setMintError(msg);
          setTimeout(() => setMintError(null), 6000);
          return;
        }
      }
      onStart();
    } finally {
      setBusyStart(false);
    }
  };

  if (isEnded) {
    return (
      <div
        className="flex shrink-0 items-center justify-end gap-2 border-b px-4 py-2"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)", color: "var(--text-muted)" }}
        >
          Session ended · returning to inbox
        </span>
      </div>
    );
  }

  return (
    <>
      {mintError && (
        <div
          className="pointer-events-auto absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-lg"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {mintError}
          {session.zoom_join_url && (
            <>
              {" "}
              <a
                href={session.zoom_join_url}
                target="_blank"
                rel="noreferrer"
                className="underline"
                style={{ color: "var(--accent-red)" }}
              >
                Open in Zoom directly
              </a>
            </>
          )}
        </div>
      )}
      {/* Engineer-side HUD — same pattern as customer side: lives in
       *  normal flow as a slim header bar, pushing chat content below
       *  instead of overlaying ("Dev Soni joined as engineer" etc).
       *  Solid surface + bottom border, no backdrop blur needed. */}
      <div
        className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-4 py-2"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        {isExpiredFree && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums"
            style={{ backgroundColor: URGENT_AMBER_SOFT, color: URGENT_AMBER }}
            title="Customer is at the paywall — buffer countdown"
          >
            Customer paying · {bufferRemainingLabel}
          </span>
        )}
        {isTimerActive && (
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums"
            style={{
              fontFamily: "var(--font-inter)",
              color: timer.isExpired ? CRIT_RED : timer.isWarning ? URGENT_AMBER : BRAND_GREEN,
            }}
          >
            {timer.format}
          </span>
        )}
        <StatusPill session={session} />
        {!state.isAssignedEngineer && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
            title="You are observing — actions are disabled."
          >
            <Eye size={11} />
            Monitoring (silent)
          </span>
        )}
        {/* Join / Start-video button moved into the inline ZoomCallCard in
            the chat — keep the FloatingStatus focused on session-level
            controls only (status pill, timer, End, Release). */}
        {state.isAssignedEngineer && (isLive || isPreLive) && (
          <button
            onClick={() => setConfirmEnd(true)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--accent-red)" }}
          >
            <PhoneOff size={11} />
            End session
          </button>
        )}
        {state.isAssignedEngineer && isPreLive && (
          <button
            onClick={() => void state.release()}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            title="Send back to queue"
          >
            <RotateCw size={11} />
            Release
          </button>
        )}
      </div>
      {confirmEnd && (
        <ConfirmEndModal
          onCancel={() => setConfirmEnd(false)}
          onConfirm={async () => { setConfirmEnd(false); await state.end(); }}
        />
      )}
    </>
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
  if (urgency === "critical")   return { label: "Critical",     bg: CRIT_RED_SOFT,    fg: CRIT_RED,     pulse: true };
  if (urgency === "urgent")     return { label: "Urgent",       bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, pulse: true };
  // Session is "Live" from the moment the engineer claims — chat works,
  // 10-min cap is ticking. "Joining call" specifically means a Zoom meeting
  // is being mounted. "On call" means both parties are in Zoom.
  if (status === "assigned")    return { label: "Live",         bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "joining")     return { label: "Joining call", bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "live")        return { label: "On call",      bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "grace")       return { label: "Reconnect…",   bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, pulse: true };
  if (status === "expired_free") return { label: "Free expired", bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER, pulse: true };
  return { label: status, bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN, pulse: false };
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
          style={{ backgroundColor: "color-mix(in srgb, var(--accent-red) 12%, transparent)", color: "var(--accent-red)" }}
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
          The video call will close. A summary is generated; you&apos;ll return to your inbox.
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

// ── Chat pane ──────────────────────────────────────────────────────────────
function ChatPane({
  state, fullWidth = false, readOnly = false,
}: {
  state: ReturnType<typeof useEngineerSession>;
  fullWidth?: boolean;
  readOnly?: boolean;            // monitor mode — hide composer entirely
}) {
  const session = state.session!;
  const isReadOnly = readOnly || session.status === "ended";
  const isSupervisor = useIsSupervisor();
  const maxW = fullWidth ? "max-w-3xl" : "max-w-none";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [state.messages.length]);

  // Engineer-only handler that mints a Zoom meeting via the edge function.
  // Used for the first-time mint and for restart after a previous meeting
  // ended. The mint function is idempotent for an active meeting (no-op)
  // and force-mints when the latest lifecycle event is "ended". On success
  // a "Zoom meeting started" system message arrives via realtime and the
  // card refreshes.
  const handleStartMeeting = async () => {
    setMinting(true);
    setMintError(null);
    try {
      const sb = createClient();
      const { error } = await sb.functions.invoke("mint-zoom-for-session", {
        body: { session_id: session.id },
      });
      if (error) {
        const msg = error.message ?? "Couldn't start a Zoom meeting";
        setMintError(msg);
        setTimeout(() => setMintError(null), 6000);
        return;
      }
      // Defensive refresh — realtime will deliver the updates, but pulling
      // the row eagerly keeps the UI in sync if the subscription drops.
      await state.refresh();
    } finally {
      setMinting(false);
    }
  };

  // Engineer-only handler that hangs up the current Zoom meeting via the
  // end-zoom-meeting edge function — saves the engineer from having to
  // open Zoom and click "End meeting for all" themselves when the customer
  // declines or the call needs to be cut short.
  const handleCancelMeeting = async () => {
    setMintError(null);
    const sb = createClient();
    const { error } = await sb.functions.invoke("end-zoom-meeting", {
      body: { session_id: session.id },
    });
    if (error) {
      const msg = error.message ?? "Couldn't end the Zoom meeting";
      setMintError(msg);
      setTimeout(() => setMintError(null), 6000);
      return;
    }
    await state.refresh();
  };

  // Latest "started" vs "ended" event drives whether the composer's
  // Start-meeting button is visible. The per-meeting cards in the chat
  // body live alongside their corresponding "started" message — each
  // meeting is its own inline entry there.
  const lastZoomEvent = [...state.messages].reverse().find(
    (m) =>
      m.sender_kind === "system" &&
      ((m.body ?? "").includes("Zoom meeting ended") || (m.body ?? "").includes("Zoom meeting started")),
  );
  const zoomEnded = !!lastZoomEvent && (lastZoomEvent.body ?? "").includes("Zoom meeting ended");

  // Composer-level start/restart affordance. Hidden when there's already an
  // active Zoom meeting (mint would be a no-op then) and in monitor mode.
  const showStartMeetingButton = !readOnly && (!session.zoom_meeting_id || zoomEnded);

  // Join URL the engineer/monitor should open. The latest active meeting
  // always points at the current session row's URLs. Supervisors (read-only
  // monitor mode) join via the anonymous observer registrant
  // (zoom_observer_url) so neither party sees who is watching — falling back
  // to the customer join URL for legacy rows minted before observer support.
  const zoomCardUrl = readOnly
    ? session.zoom_observer_url ?? session.zoom_join_url
    : session.zoom_start_url ?? session.zoom_join_url;

  // Pair "started" / "ended" system messages in chronological order so each
  // meeting renders as one inline mini-card. Paired endeds are suppressed.
  // The AI Companion summary AND the cloud-recording line that follow each
  // ended are also attached to the started so the card can reveal them
  // on demand instead of dropping separate items in the timeline.
  const meetingEnded = new Map<string, GuestMessage>();
  const meetingSummary = new Map<string, GuestMessage>();
  const meetingRecording = new Map<string, GuestMessage>();
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

  // Single-message renderer — split out so the date-separator loop below
  // can stitch in DateSeparator pills between consecutive days while
  // still routing through the existing Zoom / summary / system-line
  // suppression rules.
  const renderOneMessage = (m: GuestMessage): React.ReactNode[] => {
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
          joinUrl={!ended ? zoomCardUrl : null}
          onJoin={!ended && !readOnly ? () => void state.markJoined() : undefined}
          selfJoined={!readOnly && !!session.engineer_joined_at}
          onCancel={!ended && !readOnly ? handleCancelMeeting : undefined}
          summaryBody={summary?.body ?? null}
          recordingBody={isSupervisor ? recording?.body ?? null : null}
        />,
      ];
    }
    if (m.sender_kind === "system" && suppressedEndedIds.has(m.id)) return [];
    if (m.sender_kind === "system" && suppressedSummaryIds.has(m.id)) return [];
    if (m.sender_kind === "system" && suppressedRecordingIds.has(m.id)) return [];
    if (m.sender_kind === "system" && m.body && isAiSummaryMessageBody(m.body)) {
      return [<MeetingSummaryEntry key={m.id} body={m.body} />];
    }
    return [<Message key={m.id} message={m} />];
  };

  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className={`mx-auto w-full ${maxW}`}>
          {state.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-16 text-center">
              <Sparkles size={28} style={{ color: BRAND_GREEN }} className="mb-3" />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Say hi to {session.guest_name}.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(() => {
                // Date separator pills + bubble entries. Track the last
                // rendered date so we can inject a pill whenever the day
                // flips between consecutive messages.
                let lastDateKey: string | null = null;
                const out: React.ReactNode[] = [];
                for (const m of state.messages) {
                  if (isSupervisorOnlyMessage(m) && !isSupervisor) continue;
                  const dateKey = new Date(m.created_at).toDateString();
                  if (dateKey !== lastDateKey) {
                    lastDateKey = dateKey;
                    out.push(<DateSeparator key={`date-${m.id}`} iso={m.created_at} />);
                  }
                  out.push(...renderOneMessage(m));
                }
                return out;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Composer + (optional) call banner */}
      <div className="px-4 pb-6 pt-2">
        <div className={`mx-auto w-full ${maxW} space-y-2`}>
          {mintError && (
            <div
              className="rounded-md border px-3 py-2 text-xs"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--accent-red) 10%, transparent)",
                color: "var(--accent-red)",
              }}
            >
              {mintError}
              {session.zoom_join_url && (
                <>
                  {" · "}
                  <a
                    href={session.zoom_join_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    style={{ color: "var(--accent-red)" }}
                  >
                    Open in Zoom directly
                  </a>
                </>
              )}
            </div>
          )}
          {/* Footer:
             *  - ended       → unified "Session ended — read-only" pill
             *                  (same as customer's RoomClient ReadOnlyChatPane)
             *  - live + monitor → "Read-only · monitoring this session" pill
             *  - live + engineer → composer + icon-only Start Zoom button
             */}
          {session.status === "ended" ? (
            <div
              className="flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              <Lock size={11} />
              Session ended — read-only
            </div>
          ) : readOnly ? (
            <div
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              <Lock size={11} />
              Read-only · monitoring this session
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {showStartMeetingButton && (
                <button
                  type="button"
                  onClick={() => void handleStartMeeting()}
                  disabled={isReadOnly || minting}
                  title={session.zoom_meeting_id ? "Start a new Zoom meeting" : "Start a Zoom meeting"}
                  aria-label={session.zoom_meeting_id ? "Start a new Zoom meeting" : "Start a Zoom meeting"}
                  className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  {minting ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
                </button>
              )}
              <ChatComposer
                disabled={isReadOnly}
                placeholder={`Message ${session.guest_name}…`}
                onSend={async ({ text, files }) => {
                  await state.sendBundle({ text, files });
                }}
              />
            </div>
          )}

          {/* Project AI assistant — slim bar that lets the engineer
             *  query the customer's project history (past sessions, AI
             *  summaries, intake, files). Always visible during a live
             *  session; disabled in read-only / monitor mode and when
             *  the session isn't linked to a project. Sits below the
             *  composer so it doesn't compete with the live chat flow. */}
          {session.status !== "ended" && (
            <EngineerAiAsk
              sessionId={session.id}
              projectId={session.project_id ?? null}
              customerName={session.guest_name ?? "this customer"}
            />
          )}
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
  const mine = message.sender_kind === "engineer";
  const hasAttachments = !!message.attachments && message.attachments.length > 0;
  const hasText = !!message.body && message.body.length > 0;
  const timeLabel = new Date(message.created_at).toLocaleTimeString([], {
    hour: "numeric", minute: "2-digit",
  });
  return (
    <div
      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
      style={{ animation: "relay-bubble-in 180ms ease-out" }}
    >
      <div className="mb-0.5 px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {message.sender_name ?? (mine ? "You" : "Customer")}
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
        {/* Meta footer — time + WhatsApp-style status tick on own messages.
            We don't distinguish sent/delivered/read yet, so the single
            tick stands for "sent + landed in DB" (guaranteed by the time
            the row arrived here via realtime). */}
        <div
          className="-mb-0.5 flex items-center justify-end gap-1 pt-0.5 text-[10px]"
          style={{ color: mine ? "rgba(255,255,255,0.78)" : "var(--text-faint)" }}
        >
          <span className="tabular-nums">{timeLabel}</span>
          {mine && <Check size={11} strokeWidth={2.5} />}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DateSeparator — WhatsApp-style pill that appears between consecutive
// messages on different calendar days. "Today" / "Yesterday" / a long-form
// date for older.
// ──────────────────────────────────────────────────────────────────────────
function DateSeparator({ iso }: { iso: string }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const label = d.getTime() === today.getTime()
    ? "Today"
    : d.getTime() === yesterday.getTime()
      ? "Yesterday"
      : new Date(iso).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="flex justify-center py-1">
      <span
        className="rounded-full px-2.5 py-0.5 text-[10px] font-medium"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Summary panel (post-ended) ─────────────────────────────────────────────
// Matches the customer-side SummaryPanel in RoomClient — single SUMMARY
// header + SummaryView. The Chat-history tab was dropped because the full
// chat already lives in the main pane on the left.
function ReviewPanel({
  session,
  messages,
  currentUserId,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  /** Engineer's auth user id — forwarded to SummaryView for canEdit gating. */
  currentUserId: string | null;
}) {
  return (
    <section
      className="flex h-full flex-col border-l"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <Sparkles size={12} style={{ color: BRAND_GREEN }} />
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text)" }}>
          Summary
        </span>
        {/* Plain-text transcript export — useful when the engineer opens
            an ended session from /inbox and wants the full conversation
            as a file for their notes / docs / ticket attachment. */}
        <button
          type="button"
          onClick={() => {
            const text = buildTranscript(session, messages);
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const tsStamp = new Date(session.created_at).toISOString().slice(0, 10);
            const slug = (session.guest_name ?? "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
            a.download = `relay-transcript-${tsStamp}-${slug}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
          title="Download chat transcript as .txt"
          aria-label="Download chat transcript"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <Download size={11} />
          Transcript
        </button>
      </div>
      <SummaryView session={session} messages={messages} currentUserId={currentUserId} />
    </section>
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
   * Engineer's auth.uid. Server RPC update_guest_call_summary enforces the
   * actual ownership check — this is only the UI gate on the pencil icons.
   * Either the assigned engineer or the customer of the session may edit.
   */
  currentUserId: string | null;
}) {
  const title = session.ai_summary_title;
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];
  const dur = session.duration_minutes != null ? Math.round(Number(session.duration_minutes)) : 0;
  // Engineer who claimed the session OR the customer who owns it may edit.
  // Supervisors don't have an entry here — they hit the read-only branch.
  const canEdit =
    !!currentUserId &&
    (currentUserId === session.customer_user_id || currentUserId === session.claimed_by);
  const handleSummarySave = async (patch: {
    title?: string | null;
    overview?: string | null;
    nextSteps?: string[];
  }) => {
    const sb = createClient();
    const { error } = await sb.rpc("update_guest_call_summary", {
      _call_id: session.id,
      _title: patch.title === undefined ? null : patch.title ?? "",
      _overview: patch.overview === undefined ? null : patch.overview ?? "",
      _next_steps: patch.nextSteps === undefined ? null : patch.nextSteps,
    });
    if (error) throw new Error(error.message);
  };
  // Per-call Zoom AI Companion summaries arrive as system chat messages
  // (zoom-webhook.handleSummaryCompleted). Show them in the sidebar
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
  // Drive UI off the explicit state machine — see migration
  // 20260518200000_summary_state.sql. The old `!overview && status==='ended'`
  // check could hang forever when the AI Companion summary never landed.
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
      <div className="mb-4 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <Lock size={11} /><span>Session ended</span>{dur > 0 && <span>· {dur} min</span>}
      </div>
      {generating ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{generatingLabel}</p>
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
            The Zoom AI Companion summary didn&apos;t land within the watchdog window.
          </p>
        </div>
      ) : state === "summary_failed" && !overview ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle size={18} style={{ color: "var(--accent-red)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Couldn&apos;t generate the summary</p>
          <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
            The AI service errored. The engineer can re-run summarize-guest-call manually.
          </p>
        </div>
      ) : !overview ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No summary available.</p>
      ) : (
        <div className="space-y-5">
          {/* Inline-editable title / overview / next-steps. The assigned
              engineer and the customer of this session both get the edit
              pencil; everyone else (supervisors, observers) sees read-only. */}
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
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
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

function ErrorToast({ message }: { message: string }) {
  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
        color: "var(--accent-red)",
      }}
    >
      {message}
    </div>
  );
}

// humanState moved to lib/relay/session-status.ts so SuperviseClient renders
// identical status labels (bugs2.txt #2).

// ──────────────────────────────────────────────────────────────────────────
// Project memory — collapsible sidebar section listing every session that
// has ever run on this project, with their AI summary overview inline.
// Starts collapsed (per the engineer-parity spec) so the sidebar stays
// scannable; clicking the header expands and lazily fetches the list.
// ──────────────────────────────────────────────────────────────────────────
type ProjectMemoryRow = {
  id: string;
  title: string;
  overview: string | null;
  agent: string | null;
  minutes: number | null;
  createdAt: string;
  status: string;
};

function ProjectMemorySection({
  projectId, projectName, currentSessionId, onOpen,
}: {
  projectId: string;
  projectName: string | null;
  currentSessionId: string;
  onOpen: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectMemoryRow[] | null>(null);

  useEffect(() => {
    if (!open || rows) return;
    let alive = true;
    void (async () => {
      const sb = createClient();
      const { data } = await sb
        .from("guest_calls")
        .select("id, ai_summary_title, ai_summary_overview, agent_name, duration_minutes, created_at, status")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (!alive) return;
      setRows(
        ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          title: (r.ai_summary_title as string | null) ?? "Session",
          overview: (r.ai_summary_overview as string | null) ?? null,
          agent: (r.agent_name as string | null) ?? null,
          minutes: r.duration_minutes != null ? Math.round(Number(r.duration_minutes)) : null,
          createdAt: r.created_at as string,
          status: r.status as string,
        }))
      );
    })();
    return () => { alive = false; };
  }, [open, projectId, rows]);

  return (
    <div className="mt-5 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
      >
        <ChevronRight
          size={11}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
        <BookOpen size={11} style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Project memory{projectName ? ` · ${projectName}` : ""}
        </span>
      </button>
      {open && (
        <div className="ml-2 mt-1 space-y-1">
          {rows === null ? (
            <p className="px-2 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Loading project history…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              No prior sessions on this project.
            </p>
          ) : (
            rows.map((r) => {
              const isCurrent = r.id === currentSessionId;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => onOpen(r.id)}
                  className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
                  aria-current={isCurrent ? "page" : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px]" style={{ color: "var(--text)" }}>
                      {r.title}
                    </span>
                    {isCurrent && (
                      <span
                        className="rounded-full px-1 text-[8px] font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
                      >
                        Current
                      </span>
                    )}
                  </div>
                  {r.overview && (
                    <p
                      className="line-clamp-2 text-[10px] leading-snug"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {r.overview}
                    </p>
                  )}
                  <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
                    {r.agent ?? "Engineer"}
                    {r.minutes != null ? ` · ${r.minutes}m` : ""}
                    {" · "}
                    {new Date(r.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Transcript builder ───────────────────────────────────────────────────
// Plain-text serialisation of the chat, suitable for engineer notes /
// ticket-system attachments. Filters out Zoom-machinery system messages
// ("meeting started" / "meeting ended" / cloud-recording stubs) and the
// AI Companion summary blocks since those land in the summary card
// already — keeping the transcript a clean conversation log.
function buildTranscript(session: GuestCall, messages: GuestMessage[]): string {
  const lines: string[] = [];
  const projectLine = session.project_name ? ` · ${session.project_name}` : "";
  lines.push(`Relay session transcript`);
  lines.push(`Customer: ${session.guest_name ?? "Customer"}${projectLine}`);
  lines.push(`Engineer: ${session.agent_name ?? "—"}`);
  lines.push(`Date: ${new Date(session.created_at).toLocaleString()}`);
  if (session.duration_minutes != null) {
    lines.push(`Duration: ${Math.round(Number(session.duration_minutes))} min`);
  }
  lines.push(`Status: ${session.status}`);
  lines.push("");
  lines.push("--- conversation ---");
  lines.push("");

  for (const m of messages) {
    if (m.sender_kind === "system") {
      const body = m.body ?? "";
      if (body.includes("Zoom meeting started")) continue;
      if (body.includes("Zoom meeting ended")) continue;
      if (body.includes("Recording available")) continue;
      if (isAiSummaryMessageBody(body)) continue;
    }
    const ts = new Date(m.created_at).toLocaleString();
    const who = m.sender_kind === "engineer"
      ? `Engineer${m.sender_name ? ` (${m.sender_name})` : ""}`
      : m.sender_kind === "guest"
        ? `Customer${m.sender_name ? ` (${m.sender_name})` : ""}`
        : "System";
    lines.push(`[${ts}] ${who}:`);
    if (m.body && m.body.trim()) {
      for (const line of m.body.split(/\r?\n/)) lines.push(`  ${line}`);
    }
    if (m.attachments && m.attachments.length > 0) {
      for (const a of m.attachments) {
        lines.push(`  [attachment] ${a.name} · ${a.kind} · ${a.size_bytes ?? "?"} bytes`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
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
