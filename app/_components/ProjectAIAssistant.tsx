"use client";

/*
 * ProjectAIAssistant — engineer-side AI Q&A box.
 *
 * Sits in the right rail of the engineer's session room during an
 * active call. The engineer can ask natural-language questions
 * about the customer's project ("what was last session about?",
 * "what files did they share?", "what stack are they on?") and the
 * server-side /api/staff/project-qa route proxies to OpenAI with
 * full project context loaded (past session summaries + chat
 * transcripts + file metadata).
 *
 * The Zoom call usually runs in a SEPARATE window on the engineer's
 * desktop — so the engineer can read the customer's context here
 * while talking on the call. Hands-on UX optimization: short
 * answers, fast turn-around, no extra chrome.
 *
 * State is local — there's no server-side persistence of the Q&A
 * history. Each session room mount starts a fresh thread. That's
 * deliberate: the assistant is a scratchpad, not a transcript.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_SOFT = "var(--primary-soft)";

type Message =
  | { role: "user"; content: string; id: string }
  | { role: "assistant"; content: string; id: string; fallback?: string };

export function ProjectAIAssistant({
  projectId,
  projectName,
}: {
  projectId: string | null;
  /** Display-only — used to label the panel header. The API hydrates
   *  the real project context from projectId server-side. */
  projectName?: string | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  const send = useCallback(async () => {
    const question = draft.trim();
    if (!question || busy || !projectId) return;
    const userMsg: Message = { role: "user", content: question, id: crypto.randomUUID() };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      // Build history pairs for the model — strip our id field. We
      // include all prior turns so the engineer can ask follow-ups
      // ("ok, when was that?", "and the engineer's name?").
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/staff/project-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, question, history }),
      });
      const json = (await res.json()) as { text?: string; fallback?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Server returned ${res.status}`);
      const text = json.text ?? "AI returned no answer. Try rephrasing.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: text, id: crypto.randomUUID(), fallback: json.fallback },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't reach the AI service.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, projectId, messages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <section
      className="flex h-full flex-col border-l"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
    >
      {/* Header — Sparkles + label + project name. Keeps the panel
          unambiguously branded as "AI", not "another chat". */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
        >
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--text)" }}>
            AI project assistant
          </div>
          <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
            {projectName ? `Context for ${projectName}` : "Project context auto-loaded"}
          </div>
        </div>
      </div>

      {/* Body — message thread + empty-state coaching */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && !busy ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.content} />
              ) : (
                <AssistantBubble key={m.id} text={m.content} fallback={m.fallback} />
              ),
            )}
            {busy && <AssistantThinking />}
          </div>
        )}
      </div>

      {/* Composer — single textarea + send. Enter to send, Shift+
          Enter for newline. Send disabled when busy / empty / no
          projectId. */}
      <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--border)" }}>
        {error && (
          <p className="mb-2 text-[11px]" style={{ color: "var(--accent-red)" }}>
            {error}
          </p>
        )}
        {!projectId && (
          <p className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            No project bound to this session — the assistant has nothing to look up.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={projectId ? "Ask about this project…" : "No project — assistant disabled"}
            disabled={busy || !projectId}
            rows={2}
            className="block w-full resize-none rounded-md border bg-transparent px-2.5 py-2 text-[13px] outline-none focus:ring-2 disabled:opacity-50"
            style={{
              borderColor: "var(--border)",
              color: "var(--text)",
              ["--tw-ring-color" as string]: "color-mix(in srgb, var(--primary) 35%, transparent)",
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !draft.trim() || !projectId}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12 text-center">
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <Sparkles size={18} />
      </div>
      <p className="max-w-[280px] text-[13px] font-medium" style={{ color: "var(--text)" }}>
        Quick context, no scroll.
      </p>
      <p className="mt-1.5 max-w-[280px] text-[11.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Ask anything about this project — past sessions, files shared, stack used,
        pending next steps. The AI has full project memory.
      </p>
      <ul className="mt-4 flex flex-col gap-1 text-left text-[11px]" style={{ color: "var(--text-faint)" }}>
        <li>— What was last session about?</li>
        <li>— Which files has the customer shared?</li>
        <li>— What's still open from last call?</li>
      </ul>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed"
        style={{
          backgroundColor: BRAND_GREEN,
          color: "#fff",
          borderBottomRightRadius: 6,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text, fallback }: { text: string; fallback?: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <Sparkles size={11} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{
            backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
            color: "var(--text)",
            borderBottomLeftRadius: 6,
          }}
        >
          {text}
        </div>
        {fallback && (
          <div className="mt-1 text-[9px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            {fallback === "no_key" ? "offline mode" :
             fallback === "openai_error" ? "ai unreachable" :
             fallback === "no_context" ? "no project history yet" :
             fallback}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantThinking() {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}
      >
        <Sparkles size={11} />
      </span>
      <div
        className="rounded-2xl px-3 py-2 text-[13px] leading-relaxed"
        style={{
          backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)",
          color: "var(--text-muted)",
          borderBottomLeftRadius: 6,
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" />
          Thinking…
        </span>
      </div>
    </div>
  );
}
