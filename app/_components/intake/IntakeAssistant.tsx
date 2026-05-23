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
import { Send, Paperclip, Sparkles, ImageIcon, Code2 } from "lucide-react";
import {
  askNext,
  captureAnswer,
  emptyContext,
  type IntakeContext,
  type IntakeMessage,
  type IntakePrompt,
} from "@/lib/intake/intakeAssistant";
import { IconButton, cn } from "@/app/_components/ui";
import { createClient } from "@/lib/supabase/browser";
import {
  flattenStack,
  patchProfile,
  readProfile,
  type ProfileSnapshot,
} from "@/lib/relay/profile";

export interface IntakeAssistantProps {
  /** Notify parent each time the running context updates (for ContextCard). */
  onContextChange?: (ctx: IntakeContext) => void;
  /** Optional opener override (e.g. in-room copy vs ringing copy). */
  greeting?: string;
  /** Tighter chrome for tight panes. */
  compact?: boolean;
  /**
   * When set, every assistant + user message is appended to
   * client_intakes.intake_messages via the append_intake_message RPC so
   * the engineer's tray can read the transcript after accept. Fire-and-
   * forget: persistence failures never block the local UI.
   */
  intakeId?: string;
}

let _idCounter = 0;
const nextId = () => `m_${Date.now()}_${++_idCounter}`;

export function IntakeAssistant({
  onContextChange,
  greeting,
  compact = false,
  intakeId,
}: IntakeAssistantProps) {
  const supabaseRef = useRef(createClient());

  const persist = useCallback(
    (role: "assistant" | "user", body: string, attachment?: IntakeMessage["attachment"]) => {
      if (!intakeId) return;
      // Strip the blob: previewUrl — non-portable across sessions. Keep the
      // metadata so the engineer at least sees the filename + mime type.
      const attPayload = attachment
        ? { name: attachment.name, mime: attachment.mime }
        : null;
      void supabaseRef.current
        .rpc("append_intake_message", {
          _intake_id: intakeId,
          _role: role,
          _body: body,
          _attachment: attPayload,
        })
        .then(({ error }) => {
          if (error) console.warn("[intake] persist failed:", error.message);
        });
    },
    [intakeId],
  );
  // Bootstrap synchronously via lazy useState initializers (avoids the
  // "setState in effect" cascade and gets us a first paint with the
  // greeting + first prompt already on screen).
  //
  // Returning users (profile.hasFullIntake) skip the comfort/stack
  // re-collection — see Order 2 in UI-CHANGES.md. Instead the bot opens
  // with an INCREMENTAL stack-check ("Last time you were using X. Anything
  // new since?") that only appends diffs to profile.stack via
  // patchProfile(). // TODO(ai): this is still a local script — wire the
  // real Anthropic transport once available, signature stable.
  const [bootstrap] = useState(() => {
    const profile: ProfileSnapshot = readProfile();
    const known = flattenStack(profile.stack);
    const isReturning = profile.hasFullIntake && known.length > 0;

    // FIX 4 — resume-context handoff. If the user clicked "Continue this
    // session" / "Start a follow-up" on a stale session, /room stashed
    // { mode, fromSessionId, projectName, aiSummaryTitle, aiSummary,
    //   aiNextSteps } in localStorage. We consume it here, pick a
    // context-aware opener via local heuristics, and clear the stash so
    // it doesn't leak into future visits.
    //
    // // TODO(openai): generate context-aware resume prompts via OpenAI
    // using prior session context. Single clearly-marked seam — swap the
    // heuristic block below for an API call. No client key, no env var.
    const resumeCtx = readResumeContext();
    if (resumeCtx) {
      const prompt = pickResumePrompt(resumeCtx);
      const resumePrompt: IntakePrompt = {
        id: "wrap_up",
        body: prompt.body,
        fieldFromAnswer: null,
        quickReplies: prompt.quickReplies,
      };
      const opener =
        greeting ??
        (resumeCtx.mode === "follow_up"
          ? `Picking up from "${resumeCtx.aiSummaryTitle ?? resumeCtx.projectName ?? "your last session"}" — what's changed?`
          : `Welcome back — continuing on "${resumeCtx.aiSummaryTitle ?? resumeCtx.projectName ?? "your last session"}".`);
      const seeded: IntakeMessage[] = [
        { id: nextId(), role: "assistant", body: opener, createdAt: Date.now() },
        {
          id: nextId(),
          role: "assistant",
          body: resumePrompt.body,
          createdAt: Date.now() + 1,
        },
      ];
      clearResumeContext();
      return { seeded, first: resumePrompt, isReturning: true };
    }

    if (isReturning) {
      const knownPreview = known.slice(0, 4).join(", ");
      const stackPrompt: IntakePrompt = {
        id: "wrap_up", // re-use the "wrap_up" terminal id so askNext() stays quiet after
        body:
          known.length > 4
            ? `Last time you were using ${knownPreview} and a few others. Anything new since?`
            : `Last time you were using ${knownPreview}. Anything new since?`,
        fieldFromAnswer: null,
        quickReplies: ["No, same setup", "Cursor", "Claude", "ChatGPT", "Supabase", "Next.js"],
      };
      const opener =
        greeting ?? "Welcome back — picking up where you left off.";
      const seeded: IntakeMessage[] = [
        { id: nextId(), role: "assistant", body: opener, createdAt: Date.now() },
        {
          id: nextId(),
          role: "assistant",
          body: stackPrompt.body,
          createdAt: Date.now() + 1,
        },
      ];
      return { seeded, first: stackPrompt, isReturning: true };
    }

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
    return { seeded, first, isReturning: false };
  });

  const [ctx, setCtx] = useState<IntakeContext>(emptyContext);
  const [messages, setMessages] = useState<IntakeMessage[]>(bootstrap.seeded);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<IntakeMessage["attachment"] | null>(null);
  const [activePrompt, setActivePrompt] = useState<IntakePrompt | null>(bootstrap.first);
  // intakeDone flips true once the assistant signals it has enough
  // context (all four fields captured), either from the AI turn endpoint
  // or — if the API is unavailable — from the local fallback script.
  const [intakeDone, setIntakeDone] = useState(false);
  // True while waiting on /api/intake/turn — disables input + shows a
  // typing indicator so the chat feels responsive even at ~1s round-trips.
  const [aiPending, setAiPending] = useState(false);
  const ackIndexRef = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickAck = useCallback((): string => {
    const acks = [
      "Got it — added to your engineer's brief.",
      "Noted. Keep going — anything else they should know?",
      "Thanks. Paste a screenshot or error message if you have one.",
      "Adding that to the context.",
      "Got it. Your engineer will see this the moment they pick up.",
    ];
    const msg = acks[ackIndexRef.current % acks.length];
    ackIndexRef.current += 1;
    return msg;
  }, []);

  // Drive the conversation through /api/intake/turn. Optimistically
  // appends the user message, calls OpenAI server-side, then appends the
  // AI's reply. If the API errors (missing OPENAI_API_KEY, upstream
  // failure, bad JSON) we silently fall back to the local script + canned
  // ack so the customer never sees a dead chat.
  const runTurn = useCallback(
    async (userMsg: IntakeMessage) => {
      // 1. Optimistic append + persist of the user turn.
      setMessages((prev) => [...prev, userMsg]);
      setDraft("");
      setStaged(null);
      persist("user", userMsg.body, userMsg.attachment);
      setAiPending(true);

      // 2. Snapshot the inputs we'll send to the AI. We read the full
      //    transcript (including the optimistic userMsg) plus current
      //    context + profile + resume context. The bootstrap already
      //    consumed any resume context, so we send null here — the
      //    history carries the prior turn.
      const profile = readProfile();
      const history: { role: "assistant" | "user"; body: string }[] = [
        ...messages.map((m) => ({ role: m.role, body: m.body })),
        { role: userMsg.role, body: userMsg.body },
      ];

      try {
        const res = await fetch("/api/intake/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            context: {
              building: ctx.building,
              problem:  ctx.problem,
              stack:    ctx.stack,
              aiTools:  ctx.aiTools,
            },
            profile: {
              isReturning:  Boolean(profile.hasFullIntake),
              knownStack:   flattenStack(profile.stack),
            },
            resumeContext: null,
          }),
        });
        if (!res.ok) throw new Error(`turn http ${res.status}`);
        const turn = (await res.json()) as {
          body:            string;
          quickReplies:    string[];
          extractedFields: Partial<Record<"building" | "problem" | "stack" | "aiTools", string>>;
          intakeDone:      boolean;
        };
        if (!turn.body) throw new Error("empty body");

        // 3. Merge extracted fields into running context. Returning-user
        //    profile patching mirrors the prior script behaviour so the
        //    snapshot in localStorage stays up to date for next visit.
        const nextCtx: IntakeContext = {
          ...ctx,
          ...turn.extractedFields,
          attachments: userMsg.attachment
            ? [...ctx.attachments, userMsg.attachment]
            : ctx.attachments,
        };
        if (bootstrap.isReturning && (turn.extractedFields.aiTools || turn.extractedFields.stack)) {
          patchProfile({
            stack: {
              aiTools: turn.extractedFields.aiTools ? [turn.extractedFields.aiTools] : undefined,
            },
          });
        }

        const assistantMsg: IntakeMessage = {
          id: nextId(),
          role: "assistant",
          body: turn.body,
          createdAt: Date.now() + 1,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setCtx(nextCtx);
        setActivePrompt({
          id:               turn.intakeDone ? "wrap_up" : "wrap_up",
          body:             turn.body,
          fieldFromAnswer:  null,
          quickReplies:     turn.quickReplies,
        });
        if (turn.intakeDone) setIntakeDone(true);
        persist("assistant", assistantMsg.body);
      } catch {
        // 4. Local-script fallback. Mirrors the prior synchronous path
        //    so the customer doesn't notice the AI is down.
        const fallbackPrompt = activePrompt
          ? captureAnswer(ctx, activePrompt, userMsg.body, userMsg.attachment)
          : { ...ctx, attachments: userMsg.attachment ? [...ctx.attachments, userMsg.attachment] : ctx.attachments };
        const wasWrapUp = activePrompt?.id === "wrap_up";
        const followUp  = wasWrapUp || intakeDone || bootstrap.isReturning ? null : askNext(fallbackPrompt);
        const reply: IntakeMessage = {
          id: nextId(),
          role: "assistant",
          body: followUp ? followUp.body : pickAck(),
          createdAt: Date.now() + 1,
        };
        setMessages((prev) => [...prev, reply]);
        setCtx(fallbackPrompt);
        setActivePrompt(followUp);
        if (wasWrapUp || (!followUp && !intakeDone)) setIntakeDone(true);
        persist("assistant", reply.body);
      } finally {
        setAiPending(false);
      }
    },
    [messages, ctx, activePrompt, intakeDone, bootstrap.isReturning, persist, pickAck],
  );

  // Notify parent whenever the running context changes.
  useEffect(() => {
    onContextChange?.(ctx);
  }, [ctx, onContextChange]);

  // Persist the bootstrap messages exactly once per intake. Subsequent
  // appends happen inline in handleSubmit. Run after first paint so we
  // don't block the greeting.
  const bootstrapPersistedRef = useRef(false);
  useEffect(() => {
    if (!intakeId || bootstrapPersistedRef.current) return;
    bootstrapPersistedRef.current = true;
    for (const m of bootstrap.seeded) persist(m.role, m.body);
  }, [intakeId, bootstrap.seeded, persist]);

  // Smart auto-scroll. Only yank the thread to the bottom when the user
  // is already near the bottom (within 80px). If they've scrolled up to
  // read history, leave them alone and surface a "↓ New messages" pill
  // that jumps to the latest on click. Respects prefers-reduced-motion.
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  const isNearBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = threadRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth && !reduce ? "smooth" : "auto",
    });
    setHasNewBelow(false);
  }, []);

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    setPinnedToBottom(near);
    if (near) setHasNewBelow(false);
  }, [isNearBottom]);

  // New content arrived. If pinned, scroll. Otherwise mark "↓ New messages".
  useEffect(() => {
    if (pinnedToBottom) scrollToBottom(true);
    else setHasNewBelow(true);
    // Intentionally NOT depending on pinnedToBottom — the read-of-pin
    // happens here at the moment a message lands. Re-scroll on every
    // message-count change is the right granularity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (aiPending) return;
      const body = draft.trim();
      if (!body && !staged) return;
      const userMsg: IntakeMessage = {
        id:          nextId(),
        role:        "user",
        body:        body || (staged ? `📎 ${staged.name}` : ""),
        attachment:  staged ?? undefined,
        createdAt:   Date.now(),
      };
      void runTurn(userMsg);
    },
    [draft, staged, aiPending, runTurn],
  );

  const submitText = useCallback(
    (text: string) => {
      if (aiPending) return;
      const cleaned = text.trim();
      if (!cleaned) return;
      const userMsg: IntakeMessage = {
        id:        nextId(),
        role:      "user",
        body:      cleaned,
        createdAt: Date.now(),
      };
      void runTurn(userMsg);
    },
    [aiPending, runTurn],
  );

  return (
    <section
      className={cn(
        "flex w-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm overflow-hidden",
        compact ? "max-h-[420px]" : "h-full min-h-0 flex-1",
      )}
      aria-label="Intake assistant"
    >
      <header className="flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <span
          className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-[var(--primary-hover)]"
          aria-hidden
        >
          <Sparkles size={15} />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-[var(--text)]">
            relay intake
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Prepping context for your engineer
          </span>
        </div>
        <span
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--primary-tint)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--primary-hover)]"
          aria-label="AI assistant"
        >
          <span aria-hidden className="inline-flex size-1.5 rounded-full bg-[var(--primary)]" />
          AI
        </span>
      </header>

      <div className="relative flex-1 min-h-0">
      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="absolute inset-0 overflow-y-auto px-4 py-5 space-y-4 bg-[var(--background)]"
        role="log"
        aria-live="polite"
      >
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          return (
            <Bubble
              key={m.id}
              message={m}
              showAvatar={!isUserOrSameRoleAsPrev(messages, i)}
              onImageLoaded={() => {
                // Recompute pinned status NOW and only scroll if we were
                // already near the bottom. Avoids yanking the user.
                const el = threadRef.current;
                if (el && isNearBottom(el)) scrollToBottom(false);
              }}
            >
              {/* Quick-reply chips render under the LATEST assistant prompt
                  only, and only when the script supplied them. Single-tap
                  selection sends the chip text as the user's answer. */}
              {isLast &&
                m.role === "assistant" &&
                activePrompt?.quickReplies &&
                activePrompt.quickReplies.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activePrompt.quickReplies.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => submitText(chip)}
                        disabled={aiPending}
                        className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--text)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-tint)] hover:text-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:bg-[var(--surface)] disabled:hover:text-[var(--text)]"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
            </Bubble>
          );
        })}

        {/* Typing indicator — shown while we wait on /api/intake/turn so
            the chat doesn't sit silent for ~1s between message and reply. */}
        {aiPending && (
          <div className="flex items-end gap-2 px-3 pb-1" aria-live="polite" aria-label="Assistant is typing">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[var(--primary-hover)]">
              <Sparkles size={11} />
            </span>
            <span className="inline-flex items-center gap-1 rounded-2xl bg-[var(--surface-raised)] px-3 py-2">
              <span className="inline-block size-1.5 rounded-full bg-[var(--text-faint)] [animation:relay-typing_1.2s_ease-in-out_infinite]" />
              <span className="inline-block size-1.5 rounded-full bg-[var(--text-faint)] [animation:relay-typing_1.2s_ease-in-out_infinite_0.2s]" />
              <span className="inline-block size-1.5 rounded-full bg-[var(--text-faint)] [animation:relay-typing_1.2s_ease-in-out_infinite_0.4s]" />
            </span>
          </div>
        )}
      </div>

      {/* "↓ New messages" jump-to-latest pill — only when the user has
          scrolled up AND new content has landed since. */}
      {!pinnedToBottom && hasNewBelow && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest messages"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-transform hover:scale-[1.04]"
        >
          <span aria-hidden>↓</span>
          New messages
        </button>
      )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--border)] bg-[var(--surface)] p-3"
      >
        {staged && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-xs text-[var(--text-muted)]">
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

          <label htmlFor="intake-composer" className="sr-only">
            Type a message for your engineer
          </label>

          <div className="flex flex-1 items-end gap-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 transition-colors focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary-soft)]">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex size-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
              aria-label="Attach a screenshot"
            >
              <ImageIcon size={15} />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex size-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
              aria-label="Attach a log file"
            >
              <Paperclip size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDraft((d) => `${d}\n\`\`\`\n\n\`\`\``)}
              className="inline-flex size-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
              aria-label="Insert a code block"
            >
              <Code2 size={15} />
            </button>
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
              disabled={aiPending}
              placeholder={aiPending ? "Thinking…" : placeholder}
              className="flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-relaxed text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none disabled:cursor-not-allowed"
            />
          </div>

          <IconButton
            type="submit"
            variant="primary"
            size="md"
            disabled={aiPending || (!draft.trim() && !staged)}
            aria-label="Send message"
          >
            <Send size={16} />
          </IconButton>
        </div>
      </form>
    </section>
  );
}

function isUserOrSameRoleAsPrev(msgs: IntakeMessage[], i: number): boolean {
  if (i === 0) return false;
  return msgs[i - 1].role === msgs[i].role;
}

function Bubble({
  message,
  showAvatar,
  children,
  onImageLoaded,
}: {
  message: IntakeMessage;
  showAvatar: boolean;
  children?: React.ReactNode;
  /** Called when an embedded image finishes loading so the parent can
   *  recompute scroll position (final bubble height is only known once
   *  the image dimensions resolve). */
  onImageLoaded?: () => void;
}) {
  const isUser = message.role === "user";
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const hasImage = message.attachment?.mime.startsWith("image/") ?? false;
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {/* Bot avatar on the left — only when role changes (visual rhythm). */}
      {!isUser && (
        <div className="w-7 shrink-0">
          {showAvatar && (
            <span
              aria-hidden
              className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[var(--primary-hover)]"
            >
              <Sparkles size={13} />
            </span>
          )}
        </div>
      )}
      <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "max-w-[min(640px,72ch)] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
            isUser
              ? "bg-[var(--primary-tint)] text-[var(--text)] rounded-br-md"
              : "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-bl-md",
          )}
        >
          {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
          {hasImage && message.attachment && (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="mt-2 block w-fit overflow-hidden rounded-lg border border-[var(--border)] transition-transform hover:scale-[1.01]"
              aria-label={`Expand ${message.attachment.name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.attachment.previewUrl}
                alt={message.attachment.name}
                className="max-h-56 max-w-full object-cover"
                onLoad={onImageLoaded}
              />
            </button>
          )}
        </div>
        {children}
      </div>

      {lightboxOpen && message.attachment && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-6 backdrop-blur"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={message.attachment.previewUrl}
            alt={message.attachment.name}
            className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── Resume-context helpers ─────────────────────────────────────────────────
// FIX 4 — bridge from "Continue this session" / "Start a follow-up" on a
// stale session to a context-aware opener here.

type ResumeContext = {
  mode: "continue" | "follow_up";
  fromSessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  aiSummaryTitle: string | null;
  aiSummary: string | null;
  aiNextSteps: unknown;
  savedAt: number;
};

const RESUME_KEY = "relay-resume-context";

function readResumeContext(): ResumeContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeContext;
    // Stale handoffs older than 30 minutes are dropped — defensive against
    // a tab the user left open across days.
    if (Date.now() - (parsed.savedAt ?? 0) > 30 * 60 * 1000) {
      window.localStorage.removeItem(RESUME_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearResumeContext() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RESUME_KEY);
  } catch {
    /* swallow */
  }
}

// Heuristic resume-prompt picker.
//   // TODO(openai): swap this whole block for an OpenAI call seeded with
//   the prior session summary + next steps. Same return type so the call
//   site does not change. No client key, no env var, no real network now.
function pickResumePrompt(rc: ResumeContext): {
  body: string;
  quickReplies: string[];
} {
  const haystack = `${rc.aiSummaryTitle ?? ""} ${rc.aiSummary ?? ""}`.toLowerCase();

  // Deployment / build / CI signals → re-ring around shipping.
  if (/(deploy|build|ci\/cd|netlify|vercel|render|production)/.test(haystack)) {
    return {
      body: "Do you need more help getting this to production?",
      quickReplies: ["Yes, deployment", "Build is failing", "New error", "No, something else"],
    };
  }

  // Auth / permissions / RLS / login signals.
  if (/(auth|login|permission|rls|jwt|session token)/.test(haystack)) {
    return {
      body: "Still on the auth flow? What's blocked now?",
      quickReplies: ["New error", "Permissions issue", "Login flow", "Something else"],
    };
  }

  // Error / bug signals.
  if (/(error|bug|crash|fail|stack trace|exception)/.test(haystack)) {
    return {
      body: "Is there a new error? Paste it or drop a screenshot.",
      quickReplies: ["Same error", "New error", "Different topic", "I'll paste it"],
    };
  }

  // Topic-anchored fallback if we have a title.
  if (rc.aiSummaryTitle) {
    return {
      body: `Want to keep going on "${rc.aiSummaryTitle}"?`,
      quickReplies: ["Yes, continue", "Something new", "Paste an error"],
    };
  }

  // Generic fallback.
  return {
    body: "What's changed since last time?",
    quickReplies: ["New error", "Same project", "Different topic"],
  };
}
