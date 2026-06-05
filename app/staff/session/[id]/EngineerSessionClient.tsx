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
 * No global nav inside the room. After end_session → the engineer is sent to
 * that session's review page (/session-review/[id]); supervisor monitors go
 * back to /inbox.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOverlayDismiss } from "@/lib/relay/useOverlayDismiss";
import Link from "next/link";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import {
  Send,
  Video,
  PhoneOff,
  Loader2,
  ArrowLeft,
  RotateCw,
  Sparkles,
  Lock,
  Eye,
  LogOut,
  PanelLeftOpen,
  PanelLeftClose,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Check,
  Download,
  LifeBuoy,
  X,
  MessageSquare,
} from "lucide-react";
import { FloatingDock } from "@/app/_components/FloatingDock";
import { Wordmark } from "@/app/_components/Wordmark";
import { MeetingChatEntry } from "@/app/_components/MeetingChatEntry";
import {
  MeetingSummaryEntry,
  isAiSummaryMessageBody,
} from "@/app/_components/MeetingSummaryEntry";
import { ChatComposer } from "@/app/_components/ChatComposer";
import { EngineerAiAsk } from "@/app/_components/EngineerAiAsk";
import { AssistantLauncher } from "@/app/_components/AssistantLauncher";
import {
  broadcastAssistantEnd,
  consumePopupBlockedFlag,
} from "@/lib/relay/assistantTab";
import { MessageAttachments } from "@/app/_components/MessageAttachments";
import { EditableSummary } from "@/app/_components/EditableSummary";
import { createClient } from "@/lib/supabase/browser";
import { CUSTOMER_PREP_PRELUDE } from "@/lib/relay/engineerAiContext";
import { useEngineerSession } from "@/lib/relay/useEngineerSession";
import {
  useIsSupervisor,
  isSupervisorOnlyMessage,
} from "@/lib/relay/useIsSupervisor";
import { useSessionTimer } from "@/lib/relay/useSessionTimer";
import { humanState } from "@/lib/relay/session-status";
import {
  LaunchCallProvider,
  useLaunchCall,
  isVideoSdkEnabled,
} from "@/lib/video/LaunchCallContext";
import { CallSurface } from "@/app/_components/call/CallSurface";
import type {
  GuestCall,
  GuestMessage,
  SessionStatus,
  Urgency,
} from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";
const URGENT_AMBER = "#d4a017";
const URGENT_AMBER_SOFT = "rgba(212, 160, 23, 0.14)";
const CRIT_RED = "#8b1a1a";
const CRIT_RED_SOFT = "rgba(139, 26, 26, 0.18)";

// ── Main entry ─────────────────────────────────────────────────────────────
export function EngineerSessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const state = useEngineerSession(sessionId);
  // Anchor the engineer's elapsed-time display on assigned_at — when they
  // accepted and the session/chat began. Matches the customer view and the
  // server billing anchor; independent of the Zoom call.
  const timer = useSessionTimer(
    state.session?.assigned_at ?? state.session?.joined_at ?? null,
    state.session?.free_minutes ?? 10
  );
  const [meEmail, setMeEmail] = useState<string>("");
  // Viewer role gate. Anyone the useIsSupervisor hook recognises as a
  // supervisor-tier viewer (supervisor / super_admin per the new taxonomy)
  // is locked into read-only monitor chrome — they retain Supervisor
  // permissions and never get engineer controls, even on sessions claimed
  // by another engineer that they're inspecting.
  const isSupervisor = useIsSupervisor();

  // Where "Back" / post-session redirect sends staff: supervisors return to
  // /supervise (their home), engineers to their inbox.
  const backHref = isSupervisor ? "/supervise" : "/inbox";

  // "Join call" intent (?join=1) — set when a supervisor opens a session that
  // needs attention (shaky / at-risk / escalated) from /supervise, vs. plain
  // "Watch" on a healthy session. It lifts the read-only chat lock so the
  // supervisor can step in, exactly like the appointment flow. (Healthy →
  // "Watch" → no param → read-only.)
  const searchParams = useSearchParams();
  const joinIntent = searchParams.get("join") === "1";

  // Appointment flow: the supervisor OWNS the booking and is a genuine
  // participant, not a silent monitor. They already join the Zoom call; the
  // only thing missing was chat. So in an is_appointment session we lift the
  // read-only chat lock for supervisors (DB already permits the insert).
  // Video hosting is untouched — the assigned engineer remains the Zoom host
  // (the video token only authorises claimed_by/customer).
  const isAppointment = !!state.session?.is_appointment;
  const supervisorCanChat = isSupervisor && (isAppointment || joinIntent);

  // Appointment flow only: tell the customer's room that the moderator has
  // joined, so their ring stops and the chat/Zoom call become available even
  // before an engineer is added. Once per session; no-op for non-appointments
  // and non-supervisors (the RPC guards both). Never touches normal sessions.
  const supJoinedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const s = state.session;
    if (!s || !isSupervisor || !s.is_appointment) return;
    if (supJoinedRef.current.has(s.id)) return;
    supJoinedRef.current.add(s.id);
    void (async () => {
      try {
        await createClient().rpc("mark_supervisor_joined", { _session_id: s.id });
      } catch {
        /* best-effort */
      }
    })();
  }, [state.session?.id, state.session?.is_appointment, isSupervisor]);

  // "Join call" on an escalated session (?join=1): mark the session's active
  // escalation as joined so it counts as attended (joined_at stamped) — the
  // card "Join call" path doesn't go through the ack→join toast flow. Once per
  // session; the RPC is a no-op when there's no active escalation / already
  // joined. Skipped for ended sessions (nothing to join).
  const escJoinedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const s = state.session;
    if (!s || !isSupervisor || !joinIntent) return;
    if (s.status === "ended") return;
    if (escJoinedRef.current.has(s.id)) return;
    escJoinedRef.current.add(s.id);
    // Must await inside an async IIFE — a Supabase builder only fires when
    // then'd/awaited; a bare `void rpc()` never executes the request.
    void (async () => {
      try {
        await createClient().rpc("supervisor_join_escalation", { _session_id: s.id });
      } catch {
        /* best-effort */
      }
    })();
  }, [state.session?.id, state.session?.status, isSupervisor, joinIntent]);

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
  //
  // Chat-first flow: we deliberately do NOT auto-mount the CallSurface
  // when the engineer arrives. Both engineer + customer land in the chat
  // window. Either side starts the call via the green Video button —
  // that fires launchCall(), which mounts <CallSurface>, which then
  // posts "📞 Zoom meeting started". The other side's
  // MeetingChatEntry chat card flips to "Join call" and they decide
  // when to join, just like a regular incoming call.
  const [callOpen, setCallOpen] = useState(false);
  const launchCall: (() => void) | null = isVideoSdkEnabled()
    ? () => setCallOpen(true)
    : null;
  useEffect(() => {
    if (state.session?.status === "ended") setCallOpen(false);
  }, [state.session?.status]);

  // Reset 'started' when session changes or ends
  useEffect(() => {
    if (
      state.session?.status === "ended" ||
      state.session?.status === "queued"
    ) {
      setStarted(false);
    }
  }, [state.session?.id, state.session?.status]);

  // ── Customer-prep handoff ───────────────────────────────────────────────
  // When the engineer lands on the session room, look up the customer's
  // most-recent prep draft for this session's project (what they wrote in the
  // "Tell the engineer what you're working on" panel before ringing) and post
  // it as the opening chat message. The customer mirrored the text into
  // customer_session_drafts on "Call engineer"; the engineer can't read that
  // table under RLS, so /api/engineer/customer-draft fetches + consumes it
  // server-side with the service role. (This replaces the engineer_fetch/
  // consume_customer_draft RPCs, which shipped referencing a non-existent
  // guest_calls.customer_id column and silently errored on every call.)
  //
  // Once-per-session guard: a ref keyed by session id prevents re-renders
  // from posting the prep text twice. The route consumes the draft so the
  // next session on the same project doesn't re-replay stale prep text.
  const prepHandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const s = state.session;
    if (!s) return;
    // TEMP DIAGNOSTIC (prep handoff) — logs why the handoff does/doesn't run.
    // Remove once root-caused.
    console.warn("[prep-handoff] eval", {
      sessionId: s.id,
      status: s.status,
      isAssignedEngineer: state.isAssignedEngineer,
      isSupervisor,
      projectId: s.project_id ?? null,
      alreadyHanded: prepHandedRef.current.has(s.id),
    });
    if (!state.isAssignedEngineer || isSupervisor) return;
    if (!["assigned", "joining", "live"].includes(s.status)) return;
    if (prepHandedRef.current.has(s.id)) return;
    if (!s.project_id) return;
    prepHandedRef.current.add(s.id);
    let cancelled = false;
    void (async () => {
      try {
        const sb = createClient();
        const { data, error } = await sb.rpc("engineer_fetch_customer_draft", {
          _session_id: s.id,
        });
        if (cancelled || error || !data) return;
        const draft = data as {
          id: string;
          text: string | null;
          customer_user_id: string;
        };
        const text = (draft.text ?? "").trim();
        if (!text) return;
        // System prelude lets the engineer see "this is prep, not a live
        // message" at a glance.
        const { error: insErr } = await sb.from("guest_messages").insert([
          {
            guest_call_id: s.id,
            sender_kind: "system",
            sender_name: "Relay",
            body: CUSTOMER_PREP_PRELUDE,
          },
          {
            guest_call_id: s.id,
            sender_kind: "guest",
            sender_name: s.guest_name ?? "Customer",
            body: text,
          },
        ]);
        if (insErr) console.warn("[prep-handoff] INSERT FAILED:", insErr.message);
        else console.warn("[prep-handoff] posted opening message");
        await state.refresh();
      } catch (e) {
        console.warn("[prep-handoff] threw:", e instanceof Error ? e.message : e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    state.session?.id,
    state.session?.status,
    state.isAssignedEngineer,
    isSupervisor,
    state,
  ]);

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
    if (isSupervisor) return; // supervisors never auto-mint Zoom
    if (isVideoSdkEnabled()) return; // Video SDK owns the call surface
    if (!["assigned", "joining", "grace"].includes(s.status)) return;
    if (started || autoMinting) return;

    let cancelled = false;
    void (async () => {
      setAutoMinting(true);
      setAutoStartError(null);
      try {
        const sb = createClient();
        if (!s.zoom_meeting_id) {
          const { data, error } = await sb.functions.invoke(
            "mint-zoom-for-session",
            {
              body: { session_id: s.id },
            }
          );
          if (cancelled) return;
          if (error || !data?.zoom_meeting_id) {
            const msg =
              error?.message ??
              (data?.error as string | undefined) ??
              "Couldn't mint Zoom meeting";
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

    return () => {
      cancelled = true;
    };
  }, [
    state.session?.id,
    state.session?.status,
    state.session?.zoom_meeting_id,
    started,
    autoMinting,
  ]);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(
      ({ data }) => {
        if (data.user?.email) setMeEmail(data.user.email);
      },
      (e) => {
        // Transient network blip / sleep/wake — recoverable on next render.
        console.warn(
          "[eng-session] getUser failed:",
          e instanceof Error ? e.message : String(e)
        );
      }
    );
  }, []);

  // After a session ends, send the engineer to the PROJECT detail page
  // (full project context: sessions, files, AI assistant) rather than the
  // per-session review page — the project view is the richer post-call
  // surface. Falls back to /inbox when the session carried no project.
  // Supervisor monitors still land on /supervise. (3-second beat gives the
  // summary edge fn a head start writing the AI summary before we navigate.)
  const prevStatusRef = useRef<SessionStatus | null>(null);
  useEffect(() => {
    if (
      state.session?.status === "ended" &&
      prevStatusRef.current &&
      prevStatusRef.current !== "ended"
    ) {
      // Tell the assistant tab the session is over (it shows a "Session
      // ended" banner instead of lingering as a live-looking orphan).
      broadcastAssistantEnd(sessionId);
      const projectId = state.session?.project_id ?? null;
      const dest = isSupervisor
        ? "/supervise"
        : projectId
          ? `/staff/project/${projectId}`
          : "/inbox";
      const t = setTimeout(() => router.push(dest), 3000);
      return () => clearTimeout(t);
    }
    prevStatusRef.current = state.session?.status ?? null;
  }, [
    state.session?.status,
    state.session?.project_id,
    router,
    isSupervisor,
    sessionId,
  ]);

  // One-shot "pop-up blocked" hint: Accept tried to auto-open the
  // assistant tab and the browser blocked it — point at the launcher.
  const [popupHint, setPopupHint] = useState(false);
  useEffect(() => {
    if (consumePopupBlockedFlag()) {
      setPopupHint(true);
      const t = setTimeout(() => setPopupHint(false), 7000);
      return () => clearTimeout(t);
    }
  }, []);

  // Desktop-shell integration: hide the floating orb widget while a Relay
  // session is in flight on the engineer side. Bridge is no-op in the
  // plain browser (window.relay is undefined). Used to live in
  // PopOutContainer; that mounted with the Zoom embed, which we no longer
  // use, so we drive the signal from the session status directly.
  useEffect(() => {
    const bridge = (
      window as unknown as {
        relay?: { setSessionActive?: (active: boolean) => void };
      }
    ).relay;
    if (!bridge?.setSessionActive) return;
    const status = state.session?.status;
    const active =
      !!status && !["ended", "cancelled", "abandoned"].includes(status);
    bridge.setSessionActive(active);
    return () => {
      bridge.setSessionActive?.(false);
    };
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
    const t = setTimeout(
      () => void state.end("payment_buffer_expired"),
      remainingMs
    );
    return () => clearTimeout(t);
  }, [sess?.status, sess?.free_expired_at, state, isSupervisor]);

  if (state.loading) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ backgroundColor: "var(--background)" }}
      >
        <Loader2
          size={20}
          className="animate-spin"
          style={{ color: BRAND_GREEN }}
        />
      </div>
    );
  }

  if (!state.session) {
    return (
      <div
        className="mx-auto max-w-md px-6 py-16 text-center"
        style={{ color: "var(--text)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Session not found.
        </p>
        <button
          onClick={() => router.push(backHref)}
          className="mt-4 text-sm underline"
          style={{ color: BRAND_GREEN }}
        >
          {isSupervisor ? "Back to supervise" : "Back to inbox"}
        </button>
      </div>
    );
  }

  return (
    <LaunchCallProvider value={{ launchCall, isCallOpen: callOpen }}>
      <div
        className="flex h-screen w-screen overflow-hidden"
        style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
      >
        {/* Floating AI-assistant launcher — the only assistant UI on this
            screen. Engineers only, while the session is live-ish; click
            opens/refocuses the assistant tab, drag repositions. */}
        {!isSupervisor &&
          state.session &&
          !["ended", "cancelled", "abandoned"].includes(
            state.session.status
          ) && (
            <AssistantLauncher
              sessionId={state.session.id}
              projectId={state.session.project_id ?? null}
            />
          )}
        {popupHint && (
          <div
            className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-lg"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text)",
            }}
            role="status"
          >
            Pop-up blocked — tap the ✨ assistant button to open it.
          </div>
        )}
        <Sidebar
          engineerEmail={meEmail}
          session={state.session}
          timer={timer}
          isSupervisor={isSupervisor}
        />

        {/* Two layouts depending on whether the call is open. The AI
         *  Project Assistant no longer renders inline in EITHER — it lives
         *  in its own tab (auto-opened on Accept; the floating launcher
         *  re-opens it):
         *
         *  callOpen=true  → CallSurface fills the whole stage (video grid
         *                   gets all the space); chat in the floating dock.
         *  callOpen=false → full-width conversation (MainPane). */}
        {callOpen && state.session ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div
                className="flex h-full min-h-0 flex-col overflow-hidden"
                style={{ background: "var(--surface)" }}
              >
                {isSupervisor && (
                  <div
                    className="flex shrink-0 items-center justify-center gap-2 border-b px-3 py-1.5 text-[11px] font-medium tracking-wider uppercase"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--text) 4%, transparent)",
                      borderColor: "var(--border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    <Eye size={11} />
                    {isAppointment
                      ? "Supervisor · appointment"
                      : supervisorCanChat
                        ? "Supervisor · joined"
                        : "Supervisor · read-only"}
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
                {/* The video grid owns the full stage; the conversation
                    lives in a draggable, collapsible floating chat dock so
                    a screen-share is never cramped. */}
                <div
                  className="min-h-0 flex-1"
                  style={{ background: "var(--background)" }}
                >
                  <CallSurface
                    sessionId={state.session.id}
                    role="host"
                    userName={isSupervisor ? "Moderator" : meEmail || "Engineer"}
                    onClose={() => setCallOpen(false)}
                    onJoined={() => void state.markJoined()}
                    wideTiles
                    fillTiles
                  />
                </div>
              </div>
            </div>
            <FloatingDock
              storageKey="eng-call-chat"
              title="Chat"
              accent
              icon={<MessageSquare size={22} />}
            >
              <ChatPane
                state={state}
                fullWidth
                readOnly={!(state.isAssignedEngineer || supervisorCanChat)}
                hideAiAsk
              />
            </FloatingDock>
          </>
        ) : (
          <div className="relative flex h-full min-w-0 flex-1 flex-col">
            {isSupervisor && (
              <div
                className="flex shrink-0 items-center justify-center gap-2 border-b px-4 py-1.5 text-[11px] font-medium tracking-wider uppercase"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--text) 4%, transparent)",
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                <Eye size={11} />
                {isAppointment
                  ? "Supervisor view · appointment"
                  : supervisorCanChat
                    ? "Supervisor view · joined"
                    : "Supervisor view · read-only"}
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
              <MainPane
                state={state}
                isSupervisor={isSupervisor}
                supervisorCanChat={supervisorCanChat}
                hideAiAsk={false}
              />
            </main>
          </div>
        )}

        {state.error &&
          !state.error.includes("NOT_ASSIGNED_TO_YOU") &&
          !state.error.includes("NOT_AUTHORIZED") && (
            <ErrorToast message={state.error} onDismiss={state.clearError} />
          )}
        {autoStartError && (
          <div
            className="pointer-events-auto fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-lg"
            style={{
              borderColor:
                "color-mix(in srgb, var(--accent-red) 30%, transparent)",
              backgroundColor:
                "color-mix(in srgb, var(--accent-red) 10%, transparent)",
              color: "var(--accent-red)",
            }}
          >
            Auto-start failed: {autoStartError} — tap the{" "}
            <span className="font-semibold">video button</span> next to Send to
            retry.
          </div>
        )}
      </div>
    </LaunchCallProvider>
  );
}

// ── Layout decider ─────────────────────────────────────────────────────────
function MainPane({
  state,
  isSupervisor,
  supervisorCanChat = false,
  hideAiAsk = false,
}: {
  state: ReturnType<typeof useEngineerSession>;
  isSupervisor: boolean;
  /** Appointment flow — supervisor owns the booking, so they get the chat
   *  composer (but still no engineer-only video controls). */
  supervisorCanChat?: boolean;
  /** When the call surface is mounted in the right rail, the engineer's
   *  EngineerAiAsk lives there — suppress the inline one in the composer
   *  to avoid two parallel input boxes for the same backend. */
  hideAiAsk?: boolean;
}) {
  const session = state.session!;
  const isEnded = session.status === "ended";
  // Supervisors are read-only monitors — except in the appointment flow,
  // where the supervisor owns the booking and chats as a participant
  // (supervisorCanChat). They still never get engineer-side video controls.
  const isEngineer = state.isAssignedEngineer && !isSupervisor;
  // Who may type in the composer: the assigned engineer, or an appointment
  // supervisor.
  const canChat = isEngineer || supervisorCanChat;

  // Post-call review — chat (locked) on the left, AI summary on the right.
  if (isEnded) {
    return (
      <PanelGroup
        direction="horizontal"
        autoSaveId="relay-eng-review"
        className="h-full"
      >
        <Panel defaultSize={60} minSize={20} order={1}>
          <ChatPane state={state} fullWidth />
        </Panel>
        <Resizer />
        <Panel defaultSize={40} minSize={20} order={2}>
          <ReviewPanel
            session={session}
            messages={state.messages}
            currentUserId={state.viewerUserId}
          />
        </Panel>
      </PanelGroup>
    );
  }

  // Active session (assigned/joining/live/grace/expired_free) — full-width
  // conversation. The AI Project Assistant no longer renders inline; it
  // lives in its own tab (auto-opened on Accept, re-opened from the
  // floating launcher). hideAiAsk stays on: the assistant tab owns project
  // Q&A, so the inline EngineerAiAsk pill would be a duplicate input.
  return <ChatPane state={state} fullWidth readOnly={!canChat} hideAiAsk />;
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
  engineerEmail,
  session,
  timer,
  isSupervisor,
}: {
  engineerEmail: string;
  session: GuestCall;
  timer: ReturnType<typeof useSessionTimer>;
  isSupervisor: boolean;
}) {
  const router = useRouter();

  // Engineer ALIAS for the profile chip — the customer-facing pseudonym
  // (engineer_profiles.display_alias), not the raw email handle. Falls
  // back to the email handle while loading / when no alias is set.
  const [alias, setAlias] = useState<string | null>(null);
  useEffect(() => {
    if (isSupervisor) return;
    let alive = true;
    void (async () => {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (!alive || !u.user) return;
      const { data } = await sb
        .from("engineer_profiles")
        .select("display_alias")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (alive && data?.display_alias)
        setAlias(data.display_alias as string);
    })();
    return () => {
      alive = false;
    };
  }, [isSupervisor]);
  const displayName =
    alias ||
    engineerEmail.split("@")[0] ||
    (isSupervisor ? "Supervisor" : "Engineer");
  const [past, setPast] = useState<PastSession[]>([]);

  useEffect(() => {
    if (!session.thread_id) return;
    const sb = createClient();
    void (async () => {
      const { data } = await sb
        .from("guest_calls")
        .select(
          "id, agent_name, duration_minutes, ai_summary_title, created_at, status"
        )
        .eq("thread_id", session.thread_id!)
        .eq("status", "ended")
        .neq("id", session.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setPast(
        (data ?? []).map((r) => {
          const row = r as Record<string, unknown>;
          return {
            id: row.id as string,
            title: (row.ai_summary_title as string | null) ?? "Past session",
            agent: row.agent_name as string | null,
            minutes:
              row.duration_minutes != null
                ? Math.round(Number(row.duration_minutes))
                : null,
            date: row.created_at as string,
          };
        })
      );
    })();
  }, [session.thread_id, session.id]);

  const buckets = useMemo(() => groupByDate(past), [past]);

  // Collapsed: 60px icon rail with toggle / customer avatar / status dot /
  //            engineer avatar. Expanded: full 260px panel.
  // Default open since the engineer actively uses customer history during
  // a call; collapse is for when they want more room for the Zoom video.
  const [collapsed, setCollapsed] = useState(false);

  // Drag-to-resize the expanded sidebar. Persists per-engineer in
  // localStorage so a refresh keeps your chosen width. Collapsed state
  // still snaps to the 56-px icon rail.
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 460;
  const SIDEBAR_DEFAULT = 260;
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(
        "relay:eng-session-sidebar-width"
      );
      const parsed = raw ? Number(raw) : NaN;
      if (
        Number.isFinite(parsed) &&
        parsed >= SIDEBAR_MIN &&
        parsed <= SIDEBAR_MAX
      ) {
        setSidebarWidth(parsed);
      }
    } catch {
      /* fall back to default */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "relay:eng-session-sidebar-width",
        String(sidebarWidth)
      );
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const startSidebarDrag = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return;
      e.preventDefault();
      setSidebarDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (mv: PointerEvent) => {
        const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, mv.clientX));
        setSidebarWidth(next);
      };
      const onUp = () => {
        setSidebarDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [collapsed]
  );

  // ── Collapsed rail ──────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="flex h-full w-14 shrink-0 flex-col items-center gap-1 py-2"
        style={{
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--surface)",
        }}
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
          href={isSupervisor ? "/supervise" : "/inbox"}
          title={isSupervisor ? "Back to supervise" : "Back to inbox"}
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
        {(
          [
            "assigned",
            "joining",
            "live",
            "grace",
            "expired_free",
          ] as SessionStatus[]
        ).includes(session.status) && (
          <span
            title={`Session · ${timer.format}`}
            className="mt-1 flex h-9 w-9 items-center justify-center"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span
                className="absolute inset-0 rounded-full opacity-60"
                style={{
                  backgroundColor: BRAND_GREEN,
                  animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
                }}
              />
              <span
                className="relative h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: BRAND_GREEN }}
              />
            </span>
          </span>
        )}

        <div className="flex-1" />

        {/* Engineer avatar at bottom */}
        <div
          title={`${displayName} · Engineer · on call`}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {(displayName || "?")[0]}
        </div>
      </aside>
    );
  }

  // ── Expanded sidebar (drag-resizable) ───────────────────────────────────
  return (
    <aside
      className={`relative flex h-full shrink-0 flex-col ${sidebarDragging ? "" : "transition-[width] duration-150 ease-out"}`}
      style={{
        width: sidebarWidth,
        borderRight: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      {/* Drag handle on the right edge — invisible 6px hit zone, subtle
          accent on hover so the affordance is discoverable. Cursor flips
          to col-resize. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startSidebarDrag}
        className={`group absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-[--green-soft] ${sidebarDragging ? "bg-[--green-strong]" : ""}`}
        style={
          {
            transform: "translateX(50%)",
            ["--green-soft" as string]: BRAND_GREEN_SOFT,
            ["--green-strong" as string]: BRAND_GREEN,
          } as React.CSSProperties
        }
      />
      {/* Brand + back-to-inbox + collapse toggle */}
      <div className="flex h-12 items-center justify-between gap-1 px-3">
        <Wordmark size="md" />
        <div className="flex items-center gap-1">
          <Link
            href={isSupervisor ? "/supervise" : "/inbox"}
            className="rounded-md p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            title={isSupervisor ? "Back to supervise" : "Back to inbox"}
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
      <div className="px-3 pt-1 pb-3">
        <div
          className="flex items-center gap-3 rounded-lg border p-3"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "color-mix(in srgb, var(--text) 2%, transparent)",
          }}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase"
            style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
          >
            {(session.guest_name || "?")[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[13px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {session.guest_name}
            </div>
            <div
              className="truncate text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {session.guest_email}
            </div>
          </div>
        </div>
      </div>

      {/* Current session pill */}
      <div className="px-2">
        <div
          className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Current
        </div>
        <div
          className="flex items-center gap-2 rounded-md px-2.5 py-2"
          style={{
            backgroundColor: BRAND_GREEN_SOFT,
            border: `1px solid ${BRAND_GREEN_BORDER}`,
          }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span
              className="absolute inset-0 rounded-full opacity-70"
              style={{
                backgroundColor: BRAND_GREEN,
                animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
              }}
            />
            <span
              className="relative h-2 w-2 rounded-full"
              style={{ backgroundColor: BRAND_GREEN }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[13px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {humanState(session.status)}
            </div>
            <div
              className="truncate text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {(
                [
                  "assigned",
                  "joining",
                  "live",
                  "grace",
                  "expired_free",
                ] as SessionStatus[]
              ).includes(session.status)
                ? `${humanState(session.status)} · ${timer.format}`
                : "In session"}
            </div>
          </div>
        </div>
      </div>

      {/* Past sessions for this customer */}
      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-2">
        <div
          className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          History with {session.guest_name?.split(" ")[0] ?? "this customer"}
        </div>
        {past.length === 0 ? (
          <p
            className="px-2 py-3 text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            First session with this customer.
          </p>
        ) : (
          buckets.map(([label, items]) =>
            items.length === 0 ? null : (
              <div key={label} className="mt-3">
                <div
                  className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase"
                  style={{ color: "var(--text-muted)" }}
                >
                  {label}
                </div>
                {items.map((s) => {
                  const isCurrent = s.id === session.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        if (!isCurrent) router.push(`/staff/session/${s.id}`);
                      }}
                      aria-current={isCurrent ? "page" : undefined}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${isCurrent ? "bg-black/5 dark:bg-white/5" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: "var(--text-muted)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-[13px]"
                          style={{ color: "var(--text)" }}
                        >
                          {s.title}
                        </div>
                        <div
                          className="truncate text-[10px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {s.agent ?? "Engineer"}
                          {s.minutes != null ? ` · ${s.minutes}m` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )
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
            {(displayName || "?")[0]}
          </div>
          <div className="min-w-0 flex-1 text-left" title={engineerEmail}>
            <div
              className="truncate text-[12px] font-medium"
              style={{ color: "var(--text)" }}
            >
              {displayName}
            </div>
            <div
              className="truncate text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {isSupervisor ? "Supervisor · monitoring" : "Engineer · on call"}
            </div>
          </div>
        </div>
        {/* Escalation context for this session (raised / resolved). */}
        <SessionEscalationFlag sessionId={session.id} />
        {/* Supervisors can search the whole project's chat history. */}
        {isSupervisor && session.project_id && (
          <ProjectChatSearch projectId={session.project_id} />
        )}
        {/* Engineers can raise a hand to their supervisor mid-call. */}
        {!isSupervisor && <EscalateButton sessionId={session.id} />}
      </div>
    </aside>
  );
}

// ── G2: per-project chat search (supervisor monitor) ───────────────────────
function ProjectChatSearch({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    | {
        sessionId: string;
        senderName: string | null;
        senderKind: string;
        body: string;
        createdAt: string;
      }[]
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/supervisor/chat-search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(q.trim())}`,
        { cache: "no-store" }
      );
      const j = (await res.json().catch(() => ({}))) as {
        results?: typeof results;
      };
      setResults(j.results ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-1 rounded-lg border p-2"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        <BookOpen size={12} /> Search project chat
      </div>
      <div className="flex gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="e.g. Stripe, deadline…"
          className="h-8 flex-1 rounded-md border px-2 text-[12px] outline-none"
          style={{
            borderColor: "var(--border)",
            background: "var(--background)",
            color: "var(--text)",
          }}
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy || q.trim().length < 2}
          className="inline-flex size-8 items-center justify-center rounded-md text-white disabled:opacity-50"
          style={{ background: "var(--primary)" }}
          aria-label="Search"
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ChevronRight size={13} />
          )}
        </button>
      </div>
      {results &&
        (results.length === 0 ? (
          <p
            className="mt-2 text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            No matches.
          </p>
        ) : (
          <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => router.push(`/staff/session/${r.sessionId}`)}
                  className="w-full rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-white/5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {r.senderName || r.senderKind}
                    </span>
                    <span style={{ color: "var(--text-faint)" }}>
                      {new Date(r.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <div
                    className="line-clamp-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {r.body}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

// ── G3: this session's escalation context (banner on the session view) ──────
function SessionEscalationFlag({ sessionId }: { sessionId: string }) {
  const [esc, setEsc] = useState<{
    reason: string;
    status: string;
    note: string | null;
    resolution_note: string | null;
  } | null>(null);
  useEffect(() => {
    const sb = createClient();
    let alive = true;
    const load = async () => {
      const { data } = await sb
        .from("session_escalations")
        .select("reason, status, note, resolution_note")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive)
        setEsc(
          (data as {
            reason: string;
            status: string;
            note: string | null;
            resolution_note: string | null;
          } | null) ?? null
        );
    };
    void load();
    // Realtime so a supervisor's resolve reflects here without a reload.
    const ch = sb
      .channel(`session-escalation-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_escalations",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      alive = false;
      void sb.removeChannel(ch);
    };
  }, [sessionId]);
  if (!esc) return null;
  const open = esc.status === "open";
  const tone = open ? "var(--risk)" : "var(--text-muted)";
  return (
    <div
      className="mt-1 rounded-lg border px-2.5 py-2"
      style={{
        borderColor: tone,
        background: open
          ? "color-mix(in srgb, var(--risk) 8%, transparent)"
          : "var(--surface)",
      }}
    >
      <div
        className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: tone }}
      >
        <LifeBuoy size={12} /> Escalation · {esc.status}
      </div>
      <div className="mt-0.5 text-[12px]" style={{ color: "var(--text)" }}>
        {esc.reason}
      </div>
      {esc.note && (
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {esc.note}
        </div>
      )}
      {esc.resolution_note && (
        <div
          className="mt-0.5 text-[11px]"
          style={{ color: "var(--text-faint)" }}
        >
          ↳ {esc.resolution_note}
        </div>
      )}
    </div>
  );
}

// ── Engineer "escalate to supervisor" control ──────────────────────────────
const ESCALATION_REASONS = [
  "Need help / stuck",
  "Scope creep",
  "Customer unhappy",
  "Needs an estimate",
  "Technical blocker",
  "Other",
];

function EscalateButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(ESCALATION_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closeModal = useCallback(() => setOpen(false), []);
  const dialogRef = useOverlayDismiss(closeModal, open);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { error } = await createClient().rpc("engineer_escalate_session", {
        _session_id: sessionId,
        _reason: reason,
        _note: note.trim() || null,
      });
      if (error) throw new Error(error.message);
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        setDone(false);
        setNote("");
      }, 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't escalate.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-medium transition-colors"
        style={{
          borderColor: "color-mix(in srgb, var(--risk) 40%, transparent)",
          color: "var(--risk)",
        }}
      >
        <LifeBuoy size={13} /> Escalate to supervisor
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[var(--z-modal)]"
            style={{ backgroundColor: "var(--scrim)" }}
            onClick={() => !busy && setOpen(false)}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            className="fixed top-1/2 left-1/2 z-[var(--z-modal)] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <LifeBuoy size={16} style={{ color: "var(--risk)" }} />
              <h2
                className="text-[15px] font-semibold"
                style={{ color: "var(--text)" }}
              >
                Escalate to supervisor
              </h2>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                className="ml-auto"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={16} />
              </button>
            </div>
            {done ? (
              <p
                className="py-4 text-center text-sm"
                style={{ color: "var(--ok)" }}
              >
                Raised — your supervisor has been notified.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <label
                  className="flex flex-col gap-1 text-[12px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Reason
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="h-10 rounded-lg border px-2 text-sm"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--background)",
                      color: "var(--text)",
                    }}
                  >
                    {ESCALATION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="flex flex-col gap-1 text-[12px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Detail (optional)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="What's happening?"
                    className="rounded-lg border p-2 text-sm"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--background)",
                      color: "var(--text)",
                    }}
                  />
                </label>
                {err && (
                  <p className="text-[12px]" style={{ color: "var(--risk)" }}>
                    {err}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                    className="rounded-full px-3.5 py-1.5 text-[13px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white"
                    style={{ background: "var(--risk)" }}
                  >
                    {busy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <LifeBuoy size={13} />
                    )}{" "}
                    Raise
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── Floating top-right controls ────────────────────────────────────────────
function FloatingStatus({
  state,
  timer,
  started,
  onStart,
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
  const [minting, setMinting] = useState(false);

  const isPreLive = ["assigned", "joining", "grace"].includes(session.status);
  const isLive = session.status === "live";
  const isEnded = session.status === "ended";
  const isExpiredFree = session.status === "expired_free";
  // Timer-active = anything where the chat-inclusive 10-min clock is running.
  // Wider than isLive so the engineer sees the count from claim onwards.
  const isTimerActive = isPreLive || isLive || isExpiredFree;
  const hasMeeting = !!session.zoom_meeting_id;
  const inCall = started || isLive;

  // Start/restart Zoom control (lives beside "End session" in this HUD).
  const isSupervisor = useIsSupervisor();
  const launchCall = useLaunchCall();
  // Appointment moderator hosts the in-window Video SDK call directly.
  const isApptSupervisor = isSupervisor && !!session.is_appointment;
  // Show the control when there's no active meeting yet, or the most recent
  // one ended (restart). Mirrors the previous composer-level affordance.
  const lastZoomEvent = [...state.messages]
    .reverse()
    .find(
      (m) =>
        m.sender_kind === "system" &&
        ((m.body ?? "").includes("Zoom meeting ended") ||
          (m.body ?? "").includes("Zoom meeting started"))
    );
  const zoomEnded =
    !!lastZoomEvent &&
    (lastZoomEvent.body ?? "").includes("Zoom meeting ended");
  const showStartMeetingButton =
    state.isAssignedEngineer && (!hasMeeting || zoomEnded);

  // Buffer countdown when customer is paying
  const [, force] = useState(0);
  useEffect(() => {
    if (!isExpiredFree) return;
    const id = setInterval(() => force((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isExpiredFree]);

  let bufferRemainingLabel = "";
  if (isExpiredFree && session.free_expired_at) {
    const remMs =
      10 * 60_000 - (Date.now() - new Date(session.free_expired_at).getTime());
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
    // Whoever STARTS the call joins it immediately — open the tab
    // synchronously (inside the click's user gesture, before any await)
    // so popup blockers allow it, then point it at the start URL once the
    // mint returns. The customer sees the inline ZoomCallCard via the
    // "Zoom meeting started" system message as before.
    const popup = window.open("about:blank", "_blank");
    try {
      const sb = createClient();
      // mint-zoom-for-session is idempotent: a no-op while a meeting is
      // active, and force-mints a fresh one when the last lifecycle event
      // was "ended" (restart). Safe to invoke unconditionally.
      const { data, error } = await sb.functions.invoke(
        "mint-zoom-for-session",
        {
          body: { session_id: session.id },
        }
      );
      if (error || !data?.zoom_meeting_id) {
        popup?.close();
        const msg =
          error?.message ??
          (data?.error as string | undefined) ??
          "Couldn't mint Zoom meeting";
        setMintError(msg);
        setTimeout(() => setMintError(null), 6000);
        return;
      }
      const startUrl =
        (data.zoom_start_url as string | undefined) ??
        (data.zoom_join_url as string | undefined);
      if (startUrl) {
        if (popup) popup.location.href = startUrl;
        else window.open(startUrl, "_blank", "noopener,noreferrer");
        void state.markJoined();
      } else {
        popup?.close();
      }
      onStart();
    } finally {
      setBusyStart(false);
    }
  };

  // Mint (or restart) the Zoom meeting via the edge function. On success a
  // "Zoom meeting started" system message arrives via realtime and the inline
  // ZoomCallCard in the chat refreshes. The defensive refresh keeps the UI in
  // sync if the realtime subscription drops.
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
      await state.refresh();
    } finally {
      setMinting(false);
    }
  };

  if (isEnded) {
    return (
      <div
        className="flex shrink-0 items-center justify-end gap-2 border-b px-4 py-2"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
            color: "var(--text-muted)",
          }}
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
          className="pointer-events-auto absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-md border px-4 py-2 text-xs font-medium shadow-lg"
          style={{
            borderColor:
              "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor:
              "color-mix(in srgb, var(--accent-red) 10%, transparent)",
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
              color: timer.isExpired
                ? CRIT_RED
                : timer.isWarning
                  ? URGENT_AMBER
                  : BRAND_GREEN,
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
        {/* Start / restart the call — sits beside "End session" in the
            top-right HUD. "Whoever starts, joins": with the Video SDK
            enabled the button opens the IN-WINDOW CallSurface directly
            (same as clicking Join on the inline card — no external Zoom
            tab); the legacy Meeting flow mints + auto-opens the start URL.
            CallSurface's onJoined stamps markJoined either way. */}
        {(showStartMeetingButton || (isApptSupervisor && launchCall)) && (
          <button
            type="button"
            onClick={() => {
              if (launchCall) launchCall();
              else void startVideo();
            }}
            disabled={busyStart}
            title={
              isApptSupervisor
                ? "Start the call"
                : session.zoom_meeting_id
                  ? "Start a new Zoom meeting"
                  : "Start a Zoom meeting"
            }
            aria-label={
              isApptSupervisor
                ? "Start the call"
                : session.zoom_meeting_id
                  ? "Start a new Zoom meeting"
                  : "Start a Zoom meeting"
            }
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            {busyStart ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Video size={16} />
            )}
          </button>
        )}
        {state.isAssignedEngineer && (isLive || isPreLive) && (
          <button
            onClick={() => setConfirmEnd(true)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--accent-red)" }}
          >
            <PhoneOff size={13} />
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
          onConfirm={async () => {
            setConfirmEnd(false);
            await state.end();
          }}
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
          <span
            className="absolute inset-0 rounded-full opacity-70"
            style={{
              backgroundColor: cfg.fg,
              animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
            }}
          />
        )}
        <span
          className="relative h-2 w-2 rounded-full"
          style={{ backgroundColor: cfg.fg }}
        />
      </span>
      {cfg.label}
    </span>
  );
}

function pillConfig(status: SessionStatus, urgency: Urgency) {
  if (urgency === "critical")
    return { label: "Critical", bg: CRIT_RED_SOFT, fg: CRIT_RED, pulse: true };
  if (urgency === "urgent")
    return {
      label: "Urgent",
      bg: URGENT_AMBER_SOFT,
      fg: URGENT_AMBER,
      pulse: true,
    };
  // Session is "Live" from the moment the engineer claims — chat works,
  // 10-min cap is ticking. "Joining call" specifically means a Zoom meeting
  // is being mounted. "On call" means both parties are in Zoom.
  if (status === "assigned")
    return {
      label: "Live",
      bg: BRAND_GREEN_SOFT,
      fg: BRAND_GREEN,
      pulse: true,
    };
  if (status === "joining")
    return {
      label: "Joining call",
      bg: BRAND_GREEN_SOFT,
      fg: BRAND_GREEN,
      pulse: true,
    };
  if (status === "live")
    return {
      label: "On call",
      bg: BRAND_GREEN_SOFT,
      fg: BRAND_GREEN,
      pulse: true,
    };
  if (status === "grace")
    return {
      label: "Reconnect…",
      bg: URGENT_AMBER_SOFT,
      fg: URGENT_AMBER,
      pulse: true,
    };
  if (status === "expired_free")
    return {
      label: "Free expired",
      bg: URGENT_AMBER_SOFT,
      fg: URGENT_AMBER,
      pulse: true,
    };
  return { label: status, bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN, pulse: false };
}

function ConfirmEndModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border p-7 text-center shadow-xl"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--accent-red) 12%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          <PhoneOff size={20} />
        </div>
        <h2
          className="mb-2 text-lg font-medium"
          style={{
            fontFamily: "var(--font-source-serif)",
            color: "var(--text)",
          }}
        >
          End this session?
        </h2>
        <p
          className="mb-6 text-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          The video call will close. A summary is generated; you&apos;ll return
          to your inbox.
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
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="flex-1 rounded-full py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "var(--accent-red)", color: "#fff" }}
          >
            {busy ? (
              <Loader2 size={14} className="inline animate-spin" />
            ) : (
              "End session"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Chat pane ──────────────────────────────────────────────────────────────
function ChatPane({
  state,
  fullWidth = false,
  readOnly = false,
  hideAiAsk = false,
}: {
  state: ReturnType<typeof useEngineerSession>;
  fullWidth?: boolean;
  readOnly?: boolean; // monitor mode — hide composer entirely
  hideAiAsk?: boolean; // suppress the inline EngineerAiAsk (the
  //  call-rail version takes over while a
  //  call surface is mounted)
}) {
  const session = state.session!;
  const isReadOnly = readOnly || session.status === "ended";
  const isSupervisor = useIsSupervisor();
  const maxW = fullWidth ? "max-w-3xl" : "max-w-none";
  const scrollRef = useRef<HTMLDivElement>(null);
  // Start/restart Zoom now lives in the top-right HUD (FloatingStatus), beside
  // "End session". mintError here still surfaces failures from
  // handleCancelMeeting (the inline "End meeting" affordance on call cards).
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.messages.length]);

  // ── Auto-mark escalation as joined when a supervisor opens the session ─
  // If a supervisor (anyone NOT claimed_by) lands here AND they have an
  // acked escalation row for this session, fire mark_escalation_joined.
  // That flips the engineer's button from "Joining: {name}" → "Supervisor
  // in session" and inserts a customer-visible system chat message.
  useEffect(() => {
    if (session.status === "ended") return;
    if (!readOnly) return; // engineer who claimed it doesn't trigger join
    if (!isSupervisor) return;
    let cancelled = false;
    void (async () => {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (cancelled || !u.user) return;
      const { data } = await sb
        .from("session_escalations")
        .select("id, status")
        .eq("session_id", session.id)
        .eq("supervisor_user_id", u.user.id)
        .eq("status", "acked")
        .limit(1);
      if (cancelled) return;
      const row = (data ?? [])[0] as { id: string } | undefined;
      if (!row) return;
      await sb.rpc("mark_escalation_joined", { _id: row.id });
    })();
    return () => {
      cancelled = true;
    };
    // session.id changes on route navigation; readOnly + isSupervisor are
    // booleans that flip rarely. Re-running on those edges is fine.
  }, [session.id, session.status, readOnly, isSupervisor]);

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

  // Join URL the engineer/monitor should open. The latest active meeting
  // always points at the current session row's URLs. Supervisors (read-only
  // monitor mode) join via the anonymous observer registrant
  // (zoom_observer_url) so neither party sees who is watching — falling back
  // to the customer join URL for legacy rows minted before observer support.
  const zoomCardUrl = readOnly
    ? (session.zoom_observer_url ?? session.zoom_join_url)
    : (session.zoom_start_url ?? session.zoom_join_url);

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
      } else if (
        m.body &&
        m.body.includes("Recording available") &&
        lastEndedStartId
      ) {
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
    if (
      m.sender_kind === "system" &&
      (m.body ?? "").includes("Zoom meeting started")
    ) {
      const ended = meetingEnded.get(m.id) ?? null;
      const summary = meetingSummary.get(m.id) ?? null;
      const recording = meetingRecording.get(m.id) ?? null;
      const durationSec = ended
        ? Math.floor(
            (new Date(ended.created_at).getTime() -
              new Date(m.created_at).getTime()) /
              1000
          )
        : undefined;
      return [
        <MeetingChatEntry
          key={m.id}
          active={!ended}
          durationSec={durationSec}
          joinUrl={!ended ? zoomCardUrl : null}
          onJoin={
            !ended && !readOnly ? () => void state.markJoined() : undefined
          }
          selfJoined={!readOnly && !!session.engineer_joined_at}
          onCancel={!ended && !readOnly ? handleCancelMeeting : undefined}
          summaryBody={summary?.body ?? null}
          recordingBody={isSupervisor ? (recording?.body ?? null) : null}
        />,
      ];
    }
    if (m.sender_kind === "system" && suppressedEndedIds.has(m.id)) return [];
    if (m.sender_kind === "system" && suppressedSummaryIds.has(m.id)) return [];
    if (m.sender_kind === "system" && suppressedRecordingIds.has(m.id))
      return [];
    if (
      m.sender_kind === "system" &&
      m.body &&
      isAiSummaryMessageBody(m.body)
    ) {
      return [<MeetingSummaryEntry key={m.id} body={m.body} />];
    }
    return [<Message key={m.id} message={m} />];
  };

  return (
    <section
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--surface)" }}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className={`mx-auto w-full ${maxW}`}>
          {state.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-16 text-center">
              <Sparkles
                size={28}
                style={{ color: BRAND_GREEN }}
                className="mb-3"
              />
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
                    out.push(
                      <DateSeparator key={`date-${m.id}`} iso={m.created_at} />
                    );
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
      <div className="px-4 pt-2 pb-6">
        <div className={`mx-auto w-full ${maxW} space-y-2`}>
          {mintError && (
            <div
              className="rounded-md border px-3 py-2 text-xs"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                backgroundColor:
                  "color-mix(in srgb, var(--accent-red) 10%, transparent)",
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
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
              }}
            >
              <Lock size={11} />
              Session ended — read-only
            </div>
          ) : readOnly ? (
            <div
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[11px] font-medium"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
              }}
            >
              <Lock size={11} />
              Read-only · monitoring this session
            </div>
          ) : (
            // Start/restart Zoom control moved to the top-right bar of the
            // chat window (see ChatPane header); the composer stands alone here.
            <ChatComposer
              disabled={isReadOnly}
              placeholder={`Message ${session.guest_name}…`}
              onSend={async ({ text, files }) => {
                // A supervisor participating in an appointment posts as
                // "Moderator" (hardcoded identity), never as the engineer.
                await state.sendBundle({
                  text,
                  files,
                  senderName: isSupervisor ? "Moderator" : undefined,
                });
              }}
            />
          )}

          {/* Project AI assistant — slim bar that lets the engineer
           *  query the customer's project history (past sessions, AI
           *  summaries, intake, files). Visible during a live session
           *  unless the call surface is mounted (then the same panel
           *  lives in the right rail's bottom half — see EngineerSessionClient). */}
          {session.status !== "ended" && !hideAiAsk && (
            <EngineerAiAsk
              sessionId={session.id}
              projectId={session.project_id ?? null}
              customerName={session.guest_name ?? "this customer"}
            />
          )}

          {/* Escalation control lives inline in the Sidebar now via
           *  EscalateButton (introduced by feat/unified-onboarding's
           *  session escalations work). The previous stub here is
           *  removed; see the EscalateButton component below. */}
        </div>
      </div>
    </section>
  );
}

function Message({ message }: { message: GuestMessage }) {
  if (message.sender_kind === "system") {
    // System messages can carry attachments — the customer's pre-session
    // flush posts "📎 Customer prepared these files before the call:" with
    // the staged files attached. Render them or the engineer never sees
    // the files the customer prepared.
    const sysAttachments = message.attachments ?? [];
    return (
      <div className="flex flex-col items-center gap-2">
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[11px]"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
            color: "var(--text-muted)",
          }}
        >
          {message.body}
        </span>
        {sysAttachments.length > 0 && (
          <div
            className="flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--text) 6%, transparent)",
              color: "var(--text)",
            }}
          >
            <MessageAttachments attachments={sysAttachments} />
          </div>
        )}
      </div>
    );
  }
  const mine = message.sender_kind === "engineer";
  const hasAttachments =
    !!message.attachments && message.attachments.length > 0;
  const hasText = !!message.body && message.body.length > 0;
  const timeLabel = new Date(message.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div
      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
      style={{ animation: "relay-bubble-in 180ms ease-out" }}
    >
      <div
        className="mb-0.5 px-1 text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        {message.sender_name ?? (mine ? "You" : "Customer")}
      </div>
      <div
        className="flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap"
        style={
          mine
            ? {
                backgroundColor: BRAND_GREEN,
                color: "#fff",
                borderBottomRightRadius: 4,
              }
            : {
                backgroundColor:
                  "color-mix(in srgb, var(--text) 6%, transparent)",
                color: "var(--text)",
                borderBottomLeftRadius: 4,
              }
        }
      >
        {hasAttachments && (
          <MessageAttachments attachments={message.attachments} />
        )}
        {hasText && <div>{message.body}</div>}
        {/* Meta footer — time + WhatsApp-style status tick on own messages.
            We don't distinguish sent/delivered/read yet, so the single
            tick stands for "sent + landed in DB" (guaranteed by the time
            the row arrived here via realtime). */}
        <div
          className="-mb-0.5 flex items-center justify-end gap-1 pt-0.5 text-[10px]"
          style={{
            color: mine ? "rgba(255,255,255,0.78)" : "var(--text-faint)",
          }}
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const label =
    d.getTime() === today.getTime()
      ? "Today"
      : d.getTime() === yesterday.getTime()
        ? "Yesterday"
        : new Date(iso).toLocaleDateString([], {
            weekday: "long",
            month: "short",
            day: "numeric",
          });
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
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <Sparkles size={12} style={{ color: BRAND_GREEN }} />
        <span
          className="flex-1 text-xs font-semibold tracking-wider uppercase"
          style={{ color: "var(--text)" }}
        >
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
            const tsStamp = new Date(session.created_at)
              .toISOString()
              .slice(0, 10);
            const slug = (session.guest_name ?? "session")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .slice(0, 30);
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
      <SummaryView
        session={session}
        messages={messages}
        currentUserId={currentUserId}
      />
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
    ? (session.ai_next_steps as unknown as Array<
        string | { text?: string; description?: string }
      >)
    : [];
  const dur =
    session.duration_minutes != null
      ? Math.round(Number(session.duration_minutes))
      : 0;
  // Engineer who claimed the session OR the customer who owns it may edit.
  // Supervisors don't have an entry here — they hit the read-only branch.
  const canEdit =
    !!currentUserId &&
    (currentUserId === session.customer_user_id ||
      currentUserId === session.claimed_by);
  const handleSummarySave = async (patch: {
    title?: string | null;
    overview?: string | null;
    nextSteps?: string[];
  }) => {
    const sb = createClient();
    const { error } = await sb.rpc("update_guest_call_summary", {
      _call_id: session.id,
      _title: patch.title === undefined ? null : (patch.title ?? ""),
      _overview: patch.overview === undefined ? null : (patch.overview ?? ""),
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
    if (
      m.sender_kind !== "system" ||
      !m.body ||
      !isAiSummaryMessageBody(m.body)
    )
      return false;
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
    state === "waiting_for_transcript"
      ? "Waiting for Zoom summary…"
      : state === "generating_zoom_summary"
        ? "Reading Zoom transcript…"
        : "Generating summary…";
  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      <div
        className="mb-4 flex items-center gap-2 text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        <Lock size={11} />
        <span>Session ended</span>
        {dur > 0 && <span>· {dur} min</span>}
      </div>
      {generating ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2
            size={20}
            className="animate-spin"
            style={{ color: BRAND_GREEN }}
          />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {generatingLabel}
          </p>
        </div>
      ) : state === "no_conversation" ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            No conversation happened during this session.
          </p>
          <p
            className="max-w-xs text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Recording wasn&apos;t started and no chat messages were exchanged.
          </p>
        </div>
      ) : state === "transcript_unavailable" && !overview ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle size={18} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Zoom summary unavailable
          </p>
          <p
            className="max-w-xs text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            The Zoom AI Companion summary didn&apos;t land within the watchdog
            window.
          </p>
        </div>
      ) : state === "summary_failed" && !overview ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle size={18} style={{ color: "var(--accent-red)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Couldn&apos;t generate the summary
          </p>
          <p
            className="max-w-xs text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            The AI service errored. The engineer can re-run summarize-guest-call
            manually.
          </p>
        </div>
      ) : !overview ? (
        <p
          className="py-8 text-center text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          No summary available.
        </p>
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
              <h3
                className="mb-3 text-[10px] font-semibold tracking-wider uppercase"
                style={{ color: "var(--text-muted)" }}
              >
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
                      const { error } = await sb.rpc(
                        "update_guest_message_body",
                        {
                          _id: m.id,
                          _body: newBody,
                        }
                      );
                      if (error) throw new Error(error.message);
                    }}
                    onDelete={async () => {
                      const sb = createClient();
                      const { error } = await sb.rpc("delete_guest_message", {
                        _id: m.id,
                      });
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
      className="group relative w-2 cursor-col-resize transition-colors hover:bg-[--green-soft] data-[resize-handle-state=drag]:bg-[--green-strong]"
      style={
        {
          backgroundColor: "var(--border)",
          ["--green-soft" as string]: BRAND_GREEN_SOFT,
          ["--green-strong" as string]: BRAND_GREEN,
        } as React.CSSProperties
      }
    >
      {/* Centered grip dots so the handle is visually discoverable */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-1 opacity-60 group-hover:opacity-100"
      >
        <span
          className="block h-1 w-1 rounded-full"
          style={{ backgroundColor: "var(--text-muted)" }}
        />
        <span
          className="block h-1 w-1 rounded-full"
          style={{ backgroundColor: "var(--text-muted)" }}
        />
        <span
          className="block h-1 w-1 rounded-full"
          style={{ backgroundColor: "var(--text-muted)" }}
        />
      </span>
    </PanelResizeHandle>
  );
}

function ErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className="fixed bottom-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-start gap-2 rounded-md border px-4 py-2 text-sm shadow-lg"
      style={{
        backgroundColor: "var(--surface)",
        borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
        color: "var(--accent-red)",
      }}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="-mr-1 shrink-0 rounded p-0.5 transition-opacity hover:opacity-70"
          style={{ color: "var(--accent-red)" }}
        >
          <X size={14} />
        </button>
      )}
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
  projectId,
  projectName,
  currentSessionId,
  onOpen,
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
        .select(
          "id, ai_summary_title, ai_summary_overview, agent_name, duration_minutes, created_at, status"
        )
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
          minutes:
            r.duration_minutes != null
              ? Math.round(Number(r.duration_minutes))
              : null,
          createdAt: r.created_at as string,
          status: r.status as string,
        }))
      );
    })();
    return () => {
      alive = false;
    };
  }, [open, projectId, rows]);

  return (
    <div
      className="mt-5 border-t pt-3"
      style={{ borderColor: "var(--border)" }}
    >
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
        <span
          className="flex-1 truncate text-[10px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-muted)" }}
        >
          Project memory{projectName ? ` · ${projectName}` : ""}
        </span>
      </button>
      {open && (
        <div className="mt-1 ml-2 space-y-1">
          {rows === null ? (
            <p
              className="px-2 py-3 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              Loading project history…
            </p>
          ) : rows.length === 0 ? (
            <p
              className="px-2 py-3 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
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
                  className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
                  aria-current={isCurrent ? "page" : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="truncate text-[12px]"
                      style={{ color: "var(--text)" }}
                    >
                      {r.title}
                    </span>
                    {isCurrent && (
                      <span
                        className="rounded-full px-1 text-[8px] font-semibold tracking-wider uppercase"
                        style={{
                          backgroundColor: BRAND_GREEN_SOFT,
                          color: BRAND_GREEN,
                        }}
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
                  <div
                    className="text-[9px]"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {r.agent ?? "Engineer"}
                    {r.minutes != null ? ` · ${r.minutes}m` : ""}
                    {" · "}
                    {new Date(r.createdAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
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
    const who =
      m.sender_kind === "engineer"
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
        lines.push(
          `  [attachment] ${a.name} · ${a.kind} · ${a.size_bytes ?? "?"} bytes`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function groupByDate(past: PastSession[]): Array<[string, PastSession[]]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const buckets: Record<string, PastSession[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    Older: [],
  };
  for (const s of past) {
    const d = new Date(s.date);
    if (d >= today) buckets.Today.push(s);
    else if (d >= yesterday) buckets.Yesterday.push(s);
    else if (d >= sevenDaysAgo) buckets["Previous 7 Days"].push(s);
    else buckets.Older.push(s);
  }
  return Object.entries(buckets);
}
