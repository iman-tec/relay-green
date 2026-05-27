"use client";

/*
 * EngineerAiAsk — slim AI query bar at the bottom of the engineer live
 * session room. The engineer types or speaks a question; the API route
 * at /api/engineer/ai-ask streams an answer grounded in this customer's
 * project history (past sessions, AI summaries, intake, files).
 *
 * Resting state: single-line input bar styled like Relay's other pill
 * controls. Expanded state: an answer panel slides up ABOVE the input,
 * showing the running Q&A thread for this project (visible to every
 * engineer who picks up this project).
 *
 * Streaming uses raw fetch + ReadableStream rather than the AI SDK React
 * hooks — the server returns a text stream via streamText().toTextStreamResponse(),
 * which we decode chunk-by-chunk into the in-flight answer state.
 *
 * Citations: after the stream finishes, we query engineer_ai_queries for
 * the row's citations[] (populated server-side via onFinish). [S#] / [I]
 * / [F#] tokens in the answer text become clickable chips that open the
 * cited past session in a new tab.
 *
 * Voice input: mic button uses the Web Speech API via the shared
 * queryMicPermission + speechRecognitionErrorMessage helpers from
 * ChatComposer.tsx (same flow used by the post-call composer).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ExternalLink, Loader2, Mic, Send, Sparkles, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import {
  queryMicPermission,
  speechRecognitionErrorMessage,
} from "@/app/_components/ChatComposer";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";

type CitationKind = "summary" | "file" | "intake";
type Citation = {
  token: string;
  sessionId: string | null;
  label: string;
  kind: CitationKind;
};

type ThreadEntry = {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  askedAt: string;
  askedByMe: boolean;
  /** True while the answer is still streaming for THIS engineer. Past
   *  rows hydrated from the DB are always false. */
  streaming: boolean;
};

export function EngineerAiAsk({
  sessionId,
  projectId,
  customerName,
}: {
  sessionId: string;
  /** Null when the live session isn't linked to a project yet — the bar
   *  renders disabled with a tooltip in that case. */
  projectId: string | null;
  customerName: string;
}) {
  const sbRef = useRef(createClient());
  const [text, setText] = useState("");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meUserId, setMeUserId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Voice dictation state ─────────────────────────────────────────
  const [voiceMode, setVoiceMode] = useState<"idle" | "transcribing">("idle");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const recognitionRef = useRef<{ abort: () => void; stop: () => void } | null>(null);
  const transcribeBaseRef = useRef<string>("");

  // ── Identify the current user (used to flag "your own" Q&A in the
  // thread and to filter local optimistic state) ────────────────────
  useEffect(() => {
    let alive = true;
    void (async () => {
      const sb = sbRef.current;
      const { data: u } = await sb.auth.getUser();
      if (!alive) return;
      setMeUserId(u.user?.id ?? null);
    })();
    return () => { alive = false; };
  }, []);

  // ── Hydrate thread from engineer_ai_queries on mount ──────────────
  // Project-scoped, so the next engineer to pick up this project sees
  // the prior Q&A history. Capped at 10 most recent.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void (async () => {
      const sb = sbRef.current;
      const { data, error: qe } = await sb
        .from("engineer_ai_queries")
        .select("id, question, answer, citations, created_at, asked_by_user_id, answer_completed_at")
        .eq("project_id", projectId)
        .not("answer", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!alive) return;
      if (qe) {
        // Silent — empty history just shows the resting bar.
        return;
      }
      const rows = (data ?? []) as Array<{
        id: string;
        question: string;
        answer: string | null;
        citations: Citation[] | null;
        created_at: string;
        asked_by_user_id: string;
        answer_completed_at: string | null;
      }>;
      const entries: ThreadEntry[] = rows
        .filter((r) => r.answer)
        .map((r) => ({
          id: r.id,
          question: r.question,
          answer: r.answer ?? "",
          citations: r.citations ?? [],
          askedAt: r.created_at,
          askedByMe: meUserId === r.asked_by_user_id,
          streaming: false,
        }))
        .reverse(); // oldest-first for chronological display
      setThread(entries);
    })();
    return () => { alive = false; };
  }, [projectId, meUserId]);

  // Auto-scroll to the latest entry when the thread grows.
  useEffect(() => {
    if (!expanded || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.length, expanded]);

  // ── Submit: stream the answer ─────────────────────────────────────
  const submit = useCallback(async () => {
    if (submitting || !projectId) return;
    const question = text.trim();
    if (!question) return;

    setSubmitting(true);
    setError(null);
    setExpanded(true);

    // Local-only id for the optimistic streaming entry. Replaced with
    // the DB id when we fetch citations after the stream finishes.
    const optimisticId = `local-${Date.now()}`;
    const askedAt = new Date().toISOString();

    setThread((prev) => [
      ...prev,
      {
        id: optimisticId,
        question,
        answer: "",
        citations: [],
        askedAt,
        askedByMe: true,
        streaming: true,
      },
    ]);
    setText("");

    try {
      const res = await fetch("/api/engineer/ai-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, question }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Request failed (${res.status})`);
      }

      // Stream the body as it arrives. The server uses
      // toTextStreamResponse() which is a plain UTF-8 text stream — no
      // SSE framing.
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Response has no body");
      }
      const decoder = new TextDecoder("utf-8");
      let acc = "";
      // Read loop. We accumulate the full answer locally as well as
      // pushing each delta into thread state so the bubble grows in
      // real time.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        acc += chunk;
        setThread((prev) =>
          prev.map((entry) =>
            entry.id === optimisticId ? { ...entry, answer: acc } : entry,
          ),
        );
      }

      // Flush any trailing buffer the decoder is holding.
      const tail = decoder.decode();
      if (tail) {
        acc += tail;
        setThread((prev) =>
          prev.map((entry) =>
            entry.id === optimisticId ? { ...entry, answer: acc } : entry,
          ),
        );
      }

      // Stream finished — fetch the real row (with citations) so the
      // chip row can render. We look up the most recent row by this
      // user for this project; the placeholder insert + onFinish update
      // landed during the stream.
      const sb = sbRef.current;
      const { data: latest } = await sb
        .from("engineer_ai_queries")
        .select("id, citations, answer")
        .eq("project_id", projectId)
        .eq("asked_by_user_id", meUserId ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const real = (latest ?? null) as { id: string; citations: Citation[] | null; answer: string | null } | null;
      setThread((prev) =>
        prev.map((entry) =>
          entry.id === optimisticId
            ? {
                ...entry,
                id: real?.id ?? optimisticId,
                citations: real?.citations ?? [],
                streaming: false,
              }
            : entry,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setThread((prev) => prev.map((entry) =>
        entry.id === optimisticId
          ? { ...entry, streaming: false, answer: entry.answer || `Error: ${msg}` }
          : entry,
      ));
    } finally {
      setSubmitting(false);
    }
  }, [submitting, projectId, sessionId, text, meUserId]);

  // ── Voice dictation handlers ──────────────────────────────────────
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
    const permState = await queryMicPermission();
    if (permState === "denied") {
      setVoiceMsg("Microphone is blocked for this site. Click the lock icon → Site settings → Microphone → Allow → reload.");
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError") {
          setVoiceMsg("You dismissed the microphone prompt. Click the mic again and choose Allow.");
        } else if (e instanceof Error && e.name === "NotFoundError") {
          setVoiceMsg("No microphone detected.");
        } else {
          setVoiceMsg("Couldn't access your microphone.");
        }
        return;
      }
    }
    const r = new Ctor();
    transcribeBaseRef.current = text;
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
      setText(composed);
    };
    r.onerror = (e: { error: string }) => {
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
      setVoiceMsg("Voice recognition couldn't start — try again.");
      setVoiceMode("idle");
    }
  }, [voiceMode, text]);

  const stopTranscribe = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
  }, []);

  // Tear-down on unmount so an abandoned mic stream doesn't keep listening.
  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
  }, []);

  const disabled = !projectId;
  const placeholder = projectId
    ? `Ask about ${customerName}'s project history…`
    : "This session isn't linked to a project yet.";

  return (
    <div
      className="relative mx-auto w-full max-w-3xl"
      // Stop the live ChatComposer above from receiving the same Enter
      // submit by isolating focus events at this boundary.
      onKeyDownCapture={(e) => { if (e.key === "Enter") e.stopPropagation(); }}
    >
      {/* Expanded thread panel — only renders when there's at least one
          entry OR the engineer has actively expanded the bar. */}
      {expanded && (thread.length > 0 || submitting) && (
        <div
          className="mb-2 overflow-hidden rounded-xl border shadow-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--primary) 4%, var(--surface))",
          }}
        >
          <div
            className="flex items-center gap-2 border-b px-4 py-2"
            style={{ borderColor: "color-mix(in srgb, var(--primary) 18%, transparent)" }}
          >
            <Sparkles size={12} style={{ color: BRAND_GREEN }} />
            <span
              className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: BRAND_GREEN }}
            >
              Project AI · {customerName}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Collapse"
              className="opacity-60 transition-opacity hover:opacity-100"
              style={{ color: "var(--text-muted)" }}
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <div
            ref={scrollRef}
            className="max-h-[40vh] overflow-y-auto px-4 py-3"
          >
            {thread.length === 0 && submitting && (
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                Searching project context…
              </p>
            )}
            <div className="space-y-3">
              {thread.map((entry) => (
                <AiQaBlock key={entry.id} entry={entry} />
              ))}
            </div>
            {error && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--accent-red)" }}>
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* voiceMsg banner */}
      {voiceMsg && (
        <div
          className="mb-2 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[11px]"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
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

      {/* Resting / submit bar */}
      <div
        className="flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors"
        style={{
          borderColor: disabled
            ? "var(--border)"
            : "color-mix(in srgb, var(--primary) 35%, transparent)",
          backgroundColor: disabled
            ? "color-mix(in srgb, var(--text) 4%, transparent)"
            : "var(--surface-raised)",
          opacity: disabled ? 0.65 : 1,
        }}
        title={disabled ? "This session isn't linked to a project yet." : undefined}
      >
        <Sparkles size={14} style={{ color: BRAND_GREEN }} />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          onFocus={() => { if (thread.length > 0) setExpanded(true); }}
          placeholder={placeholder}
          disabled={disabled || submitting}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:opacity-60"
          style={{ color: "var(--text)" }}
        />
        <button
          type="button"
          onClick={voiceMode === "transcribing" ? stopTranscribe : () => void startTranscribe()}
          disabled={disabled || submitting}
          aria-label={voiceMode === "transcribing" ? "Stop dictating" : "Dictate"}
          title={voiceMode === "transcribing" ? "Stop dictating" : "Dictate — voice to text"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          style={{
            color: voiceMode === "transcribing" ? BRAND_GREEN : "var(--text-muted)",
            backgroundColor: voiceMode === "transcribing"
              ? "color-mix(in srgb, var(--primary) 14%, transparent)"
              : "transparent",
          }}
        >
          <Mic size={12} />
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || submitting || !text.trim()}
          aria-label="Ask"
          className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          Ask
        </button>
        {thread.length > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Show prior Q&A"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
            title={`${thread.length} prior question${thread.length === 1 ? "" : "s"}`}
          >
            <ChevronDown size={12} style={{ transform: "rotate(180deg)" }} />
          </button>
        )}
      </div>
    </div>
  );
}

// One Q + streaming-A block inside the expanded thread. The answer body
// renders inline citation chips: [S1] / [I] / [F3] tokens are replaced
// with clickable pills that link to the cited session-review.
function AiQaBlock({ entry }: { entry: ThreadEntry }) {
  const askedDate = useMemo(() => {
    const d = new Date(entry.askedAt);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }, [entry.askedAt]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Question bubble — right-aligned, brand green like outgoing chat
          bubbles in SessionReviewClient. Subdued when not asked by the
          current engineer (prior engineer's Q is visible but de-emphasised). */}
      <div className={`flex ${entry.askedByMe ? "justify-end" : "justify-start"}`}>
        <div
          className="max-w-[85%] rounded-2xl px-3 py-1.5 text-[12.5px] whitespace-pre-wrap"
          style={
            entry.askedByMe
              ? { backgroundColor: BRAND_GREEN, color: "#fff", borderBottomRightRadius: 4 }
              : { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)", color: "var(--text)", borderBottomLeftRadius: 4 }
          }
        >
          {!entry.askedByMe && (
            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-60">
              Asked by a prior engineer
            </div>
          )}
          {entry.question}
        </div>
      </div>
      {/* Answer block — left-aligned regardless of who asked, since the
          AI is always the responder. */}
      <div className="flex justify-start">
        <div
          className="max-w-[92%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed"
          style={{
            backgroundColor: "var(--surface-raised)",
            color: "var(--text)",
            borderBottomLeftRadius: 4,
            border: "1px solid var(--border)",
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: BRAND_GREEN }}>
            <Sparkles size={9} />
            AI · {askedDate}
            {entry.streaming && <Loader2 size={9} className="animate-spin" />}
          </div>
          <AnswerWithCitations
            answer={entry.answer}
            citations={entry.citations}
          />
          {entry.citations.length > 0 && !entry.streaming && (
            <div className="mt-2 flex flex-wrap gap-1">
              {entry.citations.map((c) => (
                <CitationChip key={c.token} citation={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Render the answer text with inline citation tokens replaced by small
// inline link pills. Streaming-friendly: the text grows token-by-token,
// so we parse the whole string each render — tokens that haven't fully
// arrived yet just render as their literal text. Uses String.matchAll
// (not the regex .exec method) so the parsing is fully declarative.
const TOKEN_PATTERN = /\[([A-Z]+\d*)\]/g;

function AnswerWithCitations({
  answer, citations,
}: {
  answer: string;
  citations: Citation[];
}) {
  const byToken = useMemo(() => {
    const m = new Map<string, Citation>();
    for (const c of citations) m.set(c.token, c);
    return m;
  }, [citations]);

  const parts = useMemo(() => {
    const out: Array<{ kind: "text" | "token"; value: string }> = [];
    let lastIndex = 0;
    for (const match of answer.matchAll(TOKEN_PATTERN)) {
      const start = match.index ?? 0;
      if (start > lastIndex) {
        out.push({ kind: "text", value: answer.slice(lastIndex, start) });
      }
      out.push({ kind: "token", value: match[1] });
      lastIndex = start + match[0].length;
    }
    if (lastIndex < answer.length) {
      out.push({ kind: "text", value: answer.slice(lastIndex) });
    }
    return out;
  }, [answer]);

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.value}</span>;
        const c = byToken.get(p.value);
        if (!c) return <span key={i}>[{p.value}]</span>;
        return <InlineCitation key={i} citation={c} />;
      })}
    </span>
  );
}

function InlineCitation({ citation }: { citation: Citation }) {
  const href = citation.sessionId
    ? `/session-review/${citation.sessionId}`
    : null;
  const baseClass = "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-semibold align-baseline";
  const style: React.CSSProperties = {
    borderColor: BRAND_GREEN,
    backgroundColor: BRAND_GREEN_SOFT,
    color: BRAND_GREEN,
  };
  if (!href) {
    return <span className={baseClass} style={style} title={citation.label}>[{citation.token}]</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={citation.label}
      className={baseClass + " transition-opacity hover:opacity-80"}
      style={style}
    >
      [{citation.token}]
    </a>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  const href = citation.sessionId
    ? `/session-review/${citation.sessionId}`
    : null;
  const body = (
    <>
      <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">
        {citation.token}
      </span>
      <span className="truncate">{citation.label}</span>
      {href && <ExternalLink size={9} className="opacity-60" />}
    </>
  );
  const className = "inline-flex max-w-[200px] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]";
  const style: React.CSSProperties = {
    borderColor: BRAND_GREEN,
    backgroundColor: "var(--surface)",
    color: BRAND_GREEN,
  };
  if (!href) {
    return <span className={className} style={style} title={citation.label}>{body}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={citation.label}
      className={className + " transition-opacity hover:opacity-80"}
      style={style}
    >
      {body}
    </a>
  );
}
