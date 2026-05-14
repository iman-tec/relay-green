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
  Send, Video, PhoneOff, Loader2, ArrowLeft, RotateCw, Sparkles, Lock, MessageSquare, Eye, LogOut,
  PanelLeftOpen, PanelLeftClose,
} from "lucide-react";
import { Wordmark } from "@/app/_components/Wordmark";
import { MeetingChatEntry } from "@/app/_components/MeetingChatEntry";
import { ChatComposer } from "@/app/_components/ChatComposer";
import { MessageAttachments } from "@/app/_components/MessageAttachments";
import { createClient } from "@/lib/supabase/browser";
import { useEngineerSession } from "@/lib/relay/useEngineerSession";
import { useSessionTimer } from "@/lib/relay/useSessionTimer";
import type { GuestCall, GuestMessage, SessionStatus, Urgency } from "@/lib/supabase/types";

const BRAND_GREEN        = "#3f5c2e";
const BRAND_GREEN_SOFT   = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";
const URGENT_AMBER       = "#c66645";
const URGENT_AMBER_SOFT  = "rgba(198, 102, 69, 0.14)";
const CRIT_RED           = "#c8553d";
const CRIT_RED_SOFT      = "rgba(200, 85, 61, 0.18)";

// ── Main entry ─────────────────────────────────────────────────────────────
export function EngineerSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const state  = useEngineerSession(sessionId);
  const timer  = useSessionTimer(state.session?.joined_at ?? null, state.session?.free_minutes ?? 10);
  const [meEmail, setMeEmail] = useState<string>("");

  // Drives whether the Zoom embed is mounted. We auto-mount the embed as
  // soon as the engineer lands on the session room (status=assigned/joining)
  // — they don't have to click "Start video". mark_joined("engineer") fires
  // ONLY when the embed's onJoined callback runs, so the customer is told
  // "engineer is calling" only when the engineer is genuinely in the Zoom
  // meeting (not just at the door).
  const [started, setStarted] = useState(false);
  const [autoMinting, setAutoMinting] = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);

  // Reset 'started' when session changes or ends
  useEffect(() => {
    if (state.session?.status === "ended" || state.session?.status === "queued") {
      setStarted(false);
    }
  }, [state.session?.id, state.session?.status]);

  // Auto-start: mint Zoom (if needed) and mount the embed whenever the
  // engineer is pre-live (assigned/joining/grace). Idempotent — re-entries
  // and reloads do the right thing. Skipped entirely for non-engineer
  // viewers (supervisors are read-only monitors).
  useEffect(() => {
    const s = state.session;
    if (!s) return;
    if (!state.isAssignedEngineer) return;
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
  // states), so customer-side firing the same call is harmless.
  const sess = state.session;
  useEffect(() => {
    if (sess?.status !== "expired_free" || !sess.free_expired_at) return;
    const elapsedMs = Date.now() - new Date(sess.free_expired_at).getTime();
    const remainingMs = 10 * 60_000 - elapsedMs;
    if (remainingMs <= 0) {
      void state.end("payment_buffer_expired");
      return;
    }
    const t = setTimeout(() => void state.end("payment_buffer_expired"), remainingMs);
    return () => clearTimeout(t);
  }, [sess?.status, sess?.free_expired_at, state]);

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
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
    >
      <Sidebar engineerEmail={meEmail} session={state.session} timer={timer} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <FloatingStatus
          state={state}
          timer={timer}
          started={started}
          onStart={() => setStarted(true)}
        />
        <main className="min-h-0 flex-1">
          <MainPane state={state} />
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
  );
}

// ── Layout decider ─────────────────────────────────────────────────────────
function MainPane({
  state,
}: {
  state: ReturnType<typeof useEngineerSession>;
}) {
  const session = state.session!;
  const isEnded = session.status === "ended";
  const isEngineer = state.isAssignedEngineer;

  // Post-call review — chat (locked) on the left, AI summary on the right.
  if (isEnded) {
    return (
      <PanelGroup direction="horizontal" autoSaveId="relay-eng-review" className="h-full">
        <Panel defaultSize={60} minSize={40} order={1}>
          <ChatPane state={state} fullWidth />
        </Panel>
        <Resizer />
        <Panel defaultSize={40} minSize={28} order={2}>
          <ReviewPanel session={session} messages={state.messages} />
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
  engineerEmail, session, timer,
}: {
  engineerEmail: string;
  session: GuestCall;
  timer: ReturnType<typeof useSessionTimer>;
}) {
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

        {/* Live pulse */}
        {session.status === "live" && (
          <span
            title={`Live · ${timer.format}`}
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
              {session.status === "live" ? `Live · ${timer.format}` : "In session"}
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
              {items.map((s) => (
                <button
                  key={s.id}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--text-muted)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]" style={{ color: "var(--text)" }}>{s.title}</div>
                    <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {s.agent ?? "Engineer"}{s.minutes != null ? ` · ${s.minutes}m` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Engineer profile */}
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
              {engineerEmail.split("@")[0] || "Engineer"}
            </div>
            <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
              Engineer · on call
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
        {isLive && (
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
  if (status === "assigned")    return { label: "Connecting",   bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "joining")     return { label: "Joining",      bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
  if (status === "live")        return { label: "Live",         bg: BRAND_GREEN_SOFT,  fg: BRAND_GREEN,  pulse: true };
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
  // always points at the current session row's URLs.
  const zoomCardUrl = readOnly
    ? session.zoom_join_url
    : session.zoom_start_url ?? session.zoom_join_url;

  // Pair "started" / "ended" system messages in chronological order so each
  // meeting renders as one inline mini-card. Paired endeds are suppressed.
  const meetingEnded = new Map<string, GuestMessage>();
  const suppressedEndedIds = new Set<string>();
  {
    const queue: GuestMessage[] = [];
    for (const m of state.messages) {
      if (m.sender_kind !== "system") continue;
      if ((m.body ?? "").includes("Zoom meeting started")) {
        queue.push(m);
      } else if ((m.body ?? "").includes("Zoom meeting ended")) {
        const start = queue.shift();
        if (start) {
          meetingEnded.set(start.id, m);
          suppressedEndedIds.add(m.id);
        }
      }
    }
  }

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
              {state.messages.flatMap((m) => {
                if (m.sender_kind === "system" && (m.body ?? "").includes("Zoom meeting started")) {
                  const ended = meetingEnded.get(m.id) ?? null;
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
                      onCancel={!ended && !readOnly ? handleCancelMeeting : undefined}
                    />,
                  ];
                }
                if (m.sender_kind === "system" && suppressedEndedIds.has(m.id)) {
                  return [];
                }
                return [<Message key={m.id} message={m} />];
              })}
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
          {/* Composer — hidden entirely in monitor (read-only) mode */}
          {!readOnly ? (
            <div className="flex flex-col gap-2">
              {showStartMeetingButton && (
                <button
                  type="button"
                  onClick={() => void handleStartMeeting()}
                  disabled={isReadOnly || minting}
                  title={session.zoom_meeting_id ? "Start a new Zoom meeting" : "Start a Zoom meeting"}
                  className="inline-flex items-center justify-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
                  style={{
                    borderColor: BRAND_GREEN_BORDER,
                    backgroundColor: BRAND_GREEN_SOFT,
                    color: BRAND_GREEN,
                  }}
                >
                  {minting ? <Loader2 size={12} className="animate-spin" /> : <Video size={12} />}
                  {session.zoom_meeting_id ? "Start a new Zoom meeting" : "Start Zoom meeting"}
                </button>
              )}
              <ChatComposer
                disabled={isReadOnly}
                placeholder={isReadOnly ? "Session ended" : `Message ${session.guest_name}…`}
                onSend={async ({ text, files }) => {
                  await state.sendBundle({ text, files });
                }}
              />
            </div>
          ) : (
            <div
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[11px] font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              <Lock size={11} />
              Read-only · monitoring this session
            </div>
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
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
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
      </div>
    </div>
  );
}

// ── Review panel (post-ended) ──────────────────────────────────────────────
function ReviewPanel({ session, messages }: { session: GuestCall; messages: GuestMessage[] }) {
  const [tab, setTab] = useState<"summary" | "chat">("summary");
  const messageCount = messages.filter((m) => m.sender_kind !== "system").length;
  return (
    <section
      className="flex h-full flex-col border-l"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <PillTab active={tab === "summary"} onClick={() => setTab("summary")}>
          <Sparkles size={11} /> Summary
        </PillTab>
        <PillTab active={tab === "chat"} onClick={() => setTab("chat")}>
          <MessageSquare size={11} /> Chat history
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
      </div>
      {tab === "summary" ? <SummaryView session={session} /> : <ChatHistoryView messages={messages} />}
    </section>
  );
}

function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
      <div className="mb-4 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <Lock size={11} /><span>Session ended</span>{dur > 0 && <span>· {dur} min</span>}
      </div>
      {generating ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Generating summary…</p>
        </div>
      ) : !overview ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No summary available.</p>
      ) : (
        <div className="space-y-5">
          {title && (
            <h2 className="text-xl font-medium"
              style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)", letterSpacing: "-0.01em" }}>
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
                      <span style={{ color: BRAND_GREEN }}>→</span><span>{text}</span>
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
        <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No messages exchanged.</p>
      ) : (
        messages.map((m) => <Message key={m.id} message={m} />)
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

function humanState(s: SessionStatus): string {
  switch (s) {
    case "queued":       return "Connecting customer…";
    case "assigned":     return "Engineer joining";
    case "joining":      return "Connecting call";
    case "live":         return "Live now";
    case "grace":        return "Reconnecting";
    case "ending":       return "Wrapping up";
    case "ended":        return "Ended";
    case "abandoned":    return "Abandoned";
    case "cancelled":    return "Cancelled";
    case "expired_free": return "Free expired";
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
