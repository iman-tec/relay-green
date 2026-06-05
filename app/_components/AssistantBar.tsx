"use client";

/*
 * AssistantBar — generic reusable AI-ask box backed by /api/assistant.
 *
 * Originally lived as a second `EngineerAiAsk` export on the
 * feat/unified-onboarding branch but collided with the engineer-session
 * streaming Q&A component of the same name. Extracted here so both can
 * coexist: this one is the lightweight assistant supervisors/staff drop
 * into miscellaneous panels (act-now rail, session sidebar mid-call),
 * while EngineerAiAsk stays the project-scoped streaming Q&A grounded
 * in past sessions / intake / files.
 *
 * Backend: POST /api/assistant with { mode: "chat", messages }. OpenAI
 * key never reaches the client; degrades to heuristic reply if absent.
 * Read-only viewers (supervisors) still get the assistant — it's an
 * aid, not a write.
 */

import { useRef, useState } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

export function AssistantBar({
  contextLabel,
  seed,
  placeholder = "Ask the assistant…",
  compact = false,
}: {
  /** Short label shown above the bar, e.g. "Scoping · Acme go-live". */
  contextLabel?: string;
  /** Optional context messages prepended to the conversation (not displayed). */
  seed?: Msg[];
  placeholder?: string;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          messages: [...(seed ?? []), ...next],
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { text?: string };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: j.text || "Sorry — I couldn't reach the assistant just now.",
        },
      ]);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry — the assistant is unavailable right now.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-3"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div
        className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--primary-hover)" }}
      >
        <Sparkles size={12} /> Assistant
        {contextLabel ? (
          <span
            className="font-normal normal-case"
            style={{ color: "var(--text-muted)" }}
          >
            {" "}
            · {contextLabel}
          </span>
        ) : null}
      </div>

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className={
            compact
              ? "flex max-h-40 flex-col gap-2 overflow-y-auto"
              : "flex max-h-64 flex-col gap-2 overflow-y-auto"
          }
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className="text-xs leading-snug"
              style={{
                color: m.role === "user" ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <span className="font-semibold">
                {m.role === "user" ? "You" : "AI"}:{" "}
              </span>
              {m.content}
            </div>
          ))}
          {busy && (
            <div
              className="flex items-center gap-1.5 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              <Loader2 size={12} className="animate-spin" /> thinking…
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          className="h-9 flex-1 rounded-lg border px-3 text-sm outline-none"
          style={{
            borderColor: "var(--border)",
            background: "var(--background)",
            color: "var(--text)",
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="inline-flex size-9 items-center justify-center rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--primary)" }}
          aria-label="Ask"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>
    </div>
  );
}
