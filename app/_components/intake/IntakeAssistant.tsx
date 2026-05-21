"use client";

/*
 * IntakeAssistant — chat-shell that walks the customer through structured
 * intake questions while they wait for an engineer (matching surface) or
 * for the call to connect (in-room). Same component, two mount points.
 *
 * 100% local state. No fetch, no model call. The script and the
 * IntakeContext shape live in `lib/intake/intakeAssistant.ts` so backend
 * can swap the transport later without touching this layout.
 *
 * The parent passes `onContextChange` so it can render a ContextCard
 * alongside (matching screen) or above (in-room) the thread.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Send, Paperclip, Sparkles } from "lucide-react";
import {
  askNext,
  captureAnswer,
  emptyContext,
  type IntakeContext,
  type IntakeMessage,
  type IntakePrompt,
} from "@/lib/intake/intakeAssistant";
import { Button, cn } from "@/app/_components/ui";

export interface IntakeAssistantProps {
  /** Notify parent each time the running context updates (for ContextCard). */
  onContextChange?: (ctx: IntakeContext) => void;
  /** Optional opener override (e.g. in-room copy vs ringing copy). */
  greeting?: string;
  /** Tighter chrome for tight panes. */
  compact?: boolean;
}

let _idCounter = 0;
const nextId = () => `m_${Date.now()}_${++_idCounter}`;

export function IntakeAssistant({
  onContextChange,
  greeting,
  compact = false,
}: IntakeAssistantProps) {
  // Bootstrap synchronously via lazy useState initializers (avoids the
  // "setState in effect" cascade and gets us a first paint with the
  // greeting + first prompt already on screen).
  const [bootstrap] = useState(() => {
    const opener =
      greeting ??
      "Hi — I'm Relay's intake helper. I'll line up context for your engineer while we connect you.";
    const first = askNext(emptyContext());
    const seeded: IntakeMessage[] = [
      { id: nextId(), role: "assistant", body: opener, createdAt: Date.now() },
    ];
    if (first) {
      seeded.push({
        id: nextId(),
        role: "assistant",
        body: first.body,
        createdAt: Date.now() + 1,
      });
    }
    return { seeded, first };
  });

  const [ctx, setCtx] = useState<IntakeContext>(emptyContext);
  const [messages, setMessages] = useState<IntakeMessage[]>(bootstrap.seeded);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<IntakeMessage["attachment"] | null>(null);
  const [activePrompt, setActivePrompt] = useState<IntakePrompt | null>(bootstrap.first);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Notify parent whenever the running context changes.
  useEffect(() => {
    onContextChange?.(ctx);
  }, [ctx, onContextChange]);

  // Scroll the thread to the bottom on new message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const placeholder = useMemo(() => {
    if (activePrompt?.composerHint) return activePrompt.composerHint;
    return "Type a message…";
  }, [activePrompt]);

  const handleFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setStaged({ name: file.name, mime: file.type || "application/octet-stream", previewUrl: url });
    // TODO(api): upload to storage. Today the preview URL is a local
    // blob:// reference; persistence is the backend's job.
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const body = draft.trim();
      if (!body && !staged) return;

      const userMsg: IntakeMessage = {
        id: nextId(),
        role: "user",
        body: body || (staged ? `📎 ${staged.name}` : ""),
        attachment: staged ?? undefined,
        createdAt: Date.now(),
      };
      const nextCtx = activePrompt
        ? captureAnswer(ctx, activePrompt, body, staged ?? undefined)
        : { ...ctx, attachments: staged ? [...ctx.attachments, staged] : ctx.attachments };

      const followUp = askNext(nextCtx);
      const assistantReply: IntakeMessage | null = followUp
        ? {
            id: nextId(),
            role: "assistant",
            body: followUp.body,
            createdAt: Date.now() + 1,
          }
        : null;

      setMessages((prev) =>
        assistantReply ? [...prev, userMsg, assistantReply] : [...prev, userMsg],
      );
      setCtx(nextCtx);
      setActivePrompt(followUp);
      setDraft("");
      setStaged(null);
    },
    [draft, staged, activePrompt, ctx],
  );

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden",
        compact ? "max-h-[420px]" : "h-full min-h-[440px]",
      )}
      aria-label="Intake assistant"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
          <Sparkles size={14} />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium text-[var(--text)]">
            Relay intake
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Prepping context for your engineer
          </span>
        </div>
      </header>

      <div
        ref={threadRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        role="log"
        aria-live="polite"
      >
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3"
      >
        {staged && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--text-muted)]">
            <Paperclip size={12} />
            <span className="truncate flex-1">{staged.name}</span>
            <button
              type="button"
              onClick={() => setStaged(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text)]"
              aria-label="Remove attachment"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.txt,.log,.md,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex size-9 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green-dot)]"
            aria-label="Attach a screenshot or log"
          >
            <Paperclip size={16} />
          </button>

          <label htmlFor="intake-composer" className="sr-only">
            Type a message for your engineer
          </label>
          <textarea
            id="intake-composer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as FormEvent);
              }
            }}
            rows={1}
            placeholder={placeholder}
            className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus-visible:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!draft.trim() && !staged}
            iconLeft={<Send size={14} />}
            aria-label="Send"
          >
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}

function Bubble({ message }: { message: IntakeMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-[var(--primary-soft)] text-[var(--text)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)]"
            : "bg-[var(--surface-raised)] text-[var(--text)] border border-[var(--border)]",
        )}
      >
        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        {message.attachment?.mime.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.attachment.previewUrl}
            alt={message.attachment.name}
            className="mt-2 max-h-40 rounded-lg border border-[var(--border)] object-cover"
          />
        )}
      </div>
    </div>
  );
}
