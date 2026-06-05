"use client";

/*
 * In-call chat dock — slots into the host's right rail while a call is
 * open. Uses the Video SDK's built-in ChatClient so messages are routed
 * peer-to-peer through Zoom (ephemeral; not persisted to guest_messages).
 */

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

type Msg = { id: string; from: string; text: string; mine: boolean };

export function ChatDock({ client }: { client: any }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const chatRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!client) return;
    // chat-on-message is emitted on the main client per the SDK docs:
    //   client.on('chat-on-message', payload => { payload.sender.name; payload.message })
    // The chat client itself is only the send-side handle.
    try {
      chatRef.current = client.getChatClient?.();
    } catch {
      chatRef.current = null;
    }

    const handler = (m: any) => {
      const me = client.getCurrentUserInfo?.();
      const isMine = !!me && m.sender?.userId === me.userId;
      // Skip our own messages — we already injected them locally on send().
      if (isMine) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `${m.timestamp ?? Date.now()}-${m.sender?.userId ?? "x"}`,
          from: String(m.sender?.name ?? "User"),
          text: String(m.message ?? ""),
          mine: false,
        },
      ]);
    };
    try {
      client.on?.("chat-on-message", handler);
    } catch {
      /* ignore */
    }
    return () => {
      try {
        client.off?.("chat-on-message", handler);
      } catch {
        /* ignore */
      }
    };
  }, [client]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !chatRef.current) return;
    setDraft("");
    try {
      const res = await chatRef.current.sendToAll?.(text);
      // The SDK swallows "no recipients" silently sometimes — surface the
      // own message locally so single-side typing still shows up.
      const me = client?.getCurrentUserInfo?.();
      if (me) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            from: String(me.displayName ?? "You"),
            text,
            mine: true,
          },
        ]);
      }
      if (
        res &&
        typeof res === "object" &&
        "type" in (res as any) &&
        (res as any).type === "ERROR"
      ) {
        console.warn("[ChatDock] send returned error:", res);
      }
    } catch (e) {
      console.warn("[ChatDock] send threw", e);
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ background: "var(--surface)", color: "var(--text)" }}
    >
      <div
        className="border-b px-3 py-2 text-[12px] font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        In-call chat
        <span className="ml-2 text-[11px] opacity-70">(call-scoped)</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <div
            className="mt-4 text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Say hi.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className="mb-2 flex flex-col"
              style={{ alignItems: m.mine ? "flex-end" : "flex-start" }}
            >
              <div
                className="text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                {m.from}
              </div>
              <div
                className="max-w-[80%] rounded-2xl px-3 py-1.5 text-sm"
                style={{
                  background: m.mine
                    ? "var(--primary)"
                    : "var(--surface-raised)",
                  color: m.mine ? "#fff" : "var(--text)",
                }}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-2 border-t px-3 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a message"
          className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none"
          style={{
            background: "var(--surface)",
            color: "var(--text)",
            borderColor: "var(--border)",
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-50"
          style={{ background: "var(--primary)", color: "#fff" }}
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
