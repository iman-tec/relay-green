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
import { Sparkles, ArrowLeft, RotateCw, Loader2, Lock } from "lucide-react";
import type { GuestCall, GuestMessage } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

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
  const hasSummary = !!session.ai_summary_overview || !!session.summary;
  const summaryGenerating = !hasSummary && session.status === "ended";

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
  generating,
  onRegenerate,
}: {
  session: GuestCall;
  generating: boolean;
  onRegenerate?: () => void;
}) {
  const title = session.ai_summary_title;
  const overview = session.ai_summary_overview ?? session.summary;
  const nextSteps = Array.isArray(session.ai_next_steps as unknown)
    ? (session.ai_next_steps as unknown as Array<string | { text?: string; description?: string }>)
    : [];

  return (
    <section className="flex h-full flex-col" style={{ backgroundColor: "var(--background)" }}>
      <div className="border-b px-5 py-3 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <Sparkles size={12} style={{ color: BRAND_GREEN }} />
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            AI summary
          </div>
        </div>
        {onRegenerate && !generating && overview && (
          <button
            onClick={onRegenerate}
            className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            <RotateCw size={11} /> Regenerate
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {generating ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 size={20} className="animate-spin" style={{ color: BRAND_GREEN }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Generating summary…
            </p>
            <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
              Reading the transcript and drafting problems, fixes, decisions, and next steps.
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
