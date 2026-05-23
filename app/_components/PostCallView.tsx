"use client";

/*
 * Post-call split layout (customer + engineer use this).
 * Left: locked chat history. Right: AI summary panel.
 *
 * Summary is populated async by the summarize-guest-call edge function.
 * While loading, shows a generating-spinner. The Realtime sub on the
 * session row will trigger a re-render once ai_summary_* columns fill in.
 */

import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
} from "react-resizable-panels";
import { Sparkles, ArrowLeft, RotateCw, Loader2, Lock, AlertTriangle } from "lucide-react";
import type { GuestCall, GuestMessage, SummaryState } from "@/lib/supabase/types";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "var(--primary-soft)";
export function PostCallView({
  session,
  messages,
  myKind, // "guest" | "engineer" — for message alignment
  onLeave,
  onRegenerate,
}: {
  session: GuestCall;
  messages: GuestMessage[];
  myKind: "guest" | "engineer";
  onLeave?: () => void;
  onRegenerate?: () => void;
}) {
  // Drive UI strictly off summary_state — the prior "spinner if no summary"
  // check could hang forever when the AI Companion summary never landed.
  // See migration 20260518200000_summary_state.sql for the lifecycle.
  const summaryState = session.summary_state ?? "idle";
  const summaryGenerating =
    summaryState === "generating_session_summary" ||
    summaryState === "generating_zoom_summary" ||
    summaryState === "waiting_for_transcript";

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: "var(--background)" }}>
      <Header session={session} onLeave={onLeave} />
      <main className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="relay-postcall">
          <Panel defaultSize={50} minSize={30} order={1}>
            <ChatHistory messages={messages} myKind={myKind} />
          </Panel>
          <Resizer />
          <Panel defaultSize={50} minSize={30} order={2}>
            <SummaryPanel
              session={session}
              summaryState={summaryState}
              generating={summaryGenerating}
              onRegenerate={onRegenerate}
            />
          </Panel>
        </PanelGroup>
      </main>
    </div>
  );
}

function Header({ session, onLeave }: { session: GuestCall; onLeave?: () => void }) {
  const reasonLabel =
    session.ended_reason === "free_session_expired"
      ? "Free session expired"
      : session.ended_reason === "customer_cancelled"
      ? "Cancelled"
      : "Session ended";

  const dur = session.duration_minutes != null ? Math.round(Number(session.duration_minutes)) : 0;

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b px-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex items-center gap-3">
        {onLeave && (
          <button
            onClick={onLeave}
            className="rounded-md p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            aria-label="Leave"
          >
            <ArrowLeft size={14} style={{ color: "var(--text-muted)" }} />
          </button>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)", color: "var(--text-muted)" }}>
          <Lock size={11} /> {reasonLabel}
        </span>
        {dur > 0 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {dur} min
          </span>
        )}
      </div>
    </header>
  );
}

function ChatHistory({ messages, myKind }: { messages: GuestMessage[]; myKind: "guest" | "engineer" }) {
  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--surface)" }}>
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Chat history
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {messages.length} message{messages.length !== 1 ? "s" : ""} · read-only
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
        {messages.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No messages exchanged.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} myKind={myKind} />)
        )}
      </div>
    </section>
  );
}

function MessageBubble({ message, myKind }: { message: GuestMessage; myKind: "guest" | "engineer" }) {
  if (message.sender_kind === "system") {
    return (
      <div className="flex justify-center">
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[11px]"
          style={{ backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text-muted)" }}
        >
          {message.body}
        </span>
      </div>
    );
  }
  const mine = message.sender_kind === myKind;
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="mb-0.5 px-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {message.sender_name ?? message.sender_kind}
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

function SummaryPanel({
  session,
  summaryState,
  generating,
  onRegenerate,
}: {
  session: GuestCall;
  summaryState: SummaryState;
  generating: boolean;
  onRegenerate?: () => void;
}) {
  const title = session.ai_summary_title;
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];

  // Per-state copy. Centralized here so the generating/failed/empty branches
  // below stay short.
  const generatingLabel =
    summaryState === "waiting_for_transcript"
      ? "Waiting for Zoom summary…"
      : summaryState === "generating_zoom_summary"
      ? "Reading Zoom transcript…"
      : "Generating summary…";

  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--background)" }}>
      <div className="border-b px-5 py-3 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <Sparkles size={12} style={{ color: BRAND_GREEN }} />
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            AI summary
          </div>
        </div>
        {onRegenerate && !generating && (summaryState === "summary_ready" || summaryState === "summary_failed" || summaryState === "transcript_unavailable") && (
          <button
            onClick={onRegenerate}
            className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            <RotateCw size={11} /> {summaryState === "summary_failed" ? "Retry" : "Regenerate"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {generating ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {generatingLabel}
            </p>
            <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
              {summaryState === "waiting_for_transcript"
                ? "Zoom delivers the AI Companion summary 1-5 minutes after the call ends."
                : "Reading the transcript and drafting problems, fixes, decisions, and next steps."}
            </p>
          </div>
        ) : summaryState === "no_conversation" ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              No conversation happened during this session.
            </p>
            <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
              Recording wasn&apos;t started and no chat messages were exchanged, so there&apos;s nothing to summarize.
            </p>
          </div>
        ) : summaryState === "transcript_unavailable" && !overview ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle size={18} style={{ color: "var(--text-muted)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Zoom summary unavailable
            </p>
            <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
              The Zoom AI Companion summary didn&apos;t land. If recording wasn&apos;t started in the meeting, no transcript is produced.
            </p>
          </div>
        ) : summaryState === "summary_failed" && !overview ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle size={18} style={{ color: "var(--accent-red)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Couldn&apos;t generate the summary
            </p>
            <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
              The AI service errored. Click Retry above to try again.
            </p>
          </div>
        ) : !overview ? (
          <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No summary available.
          </p>
        ) : (
          <div className="space-y-6">
            {title && (
              <h2
                className="text-2xl font-medium"
                style={{ fontFamily: "var(--font-source-serif)", color: "var(--text)", letterSpacing: "-0.01em" }}
              >
                {title}
              </h2>
            )}
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>
              {overview}
            </div>
            {nextSteps.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Next steps
                </h3>
                <ul className="space-y-2">
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
    </section>
  );
}

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
