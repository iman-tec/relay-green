"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { Loader2, Send, ArrowLeft } from "lucide-react";
import { readProfile, type Need, type ProfileStack, type Urgency } from "@/lib/relay/profile";

type FunnelContext = {
  need: Need | null;
  stack: ProfileStack;
  urgency: Urgency | null;
  engineerId: string | null;
  engineerPseudoName: string | null;
  createdAt: number;
};

type Msg = { id: string; role: "assistant" | "user" | "system"; body: string };

function readFunnelCtx(): FunnelContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("relay-tryrelay-context");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FunnelContext>;
    return {
      need: (parsed.need ?? null) as Need | null,
      stack: parsed.stack ?? { aiTools: [], backend: [], frontend: [] },
      urgency: (parsed.urgency ?? null) as Urgency | null,
      engineerId: parsed.engineerId ?? null,
      engineerPseudoName: parsed.engineerPseudoName ?? null,
      createdAt: parsed.createdAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function TryRoomClient() {
  const [ctx, setCtx] = useState<FunnelContext | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Hydrate funnel context + initial assistant greeting.
  useEffect(() => {
    const funnel = readFunnelCtx();
    setCtx(funnel);
    setHydrated(true);
    const profile = readProfile();
    void fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "greeting",
        funnel: funnel
          ? { need: funnel.need, stack: funnel.stack, urgency: funnel.urgency }
          : undefined,
        profile: {
          techComfort: profile.techComfort,
          stack: profile.stack,
          urgency: profile.urgency,
        },
      }),
    })
      .then((r) => r.json())
      .then((j: { text?: string; fallback?: string }) => {
        if (j.fallback) {
          console.warn("[try-room] assistant fallback:", j.fallback);
        }
        setMessages([
          {
            id: uid(),
            role: "assistant",
            body:
              j.text ??
              "Hi — I'm Relay's intake helper. Describe what you're stuck on and I'll line up context for your engineer.",
          },
        ]);
      })
      .catch(() => {
        setMessages([
          {
            id: uid(),
            role: "assistant",
            body:
              "Hi — I'm Relay's intake helper. Describe what you're stuck on and I'll line up context for your engineer.",
          },
        ]);
      });
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages.length, thinking]);

  const stackTags = useMemo(() => {
    if (!ctx) return [] as string[];
    return [...ctx.stack.aiTools, ...ctx.stack.backend, ...ctx.stack.frontend];
  }, [ctx]);

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const text = draft.trim();
      if (!text || thinking) return;
      const userMsg: Msg = { id: uid(), role: "user", body: text };
      setMessages((m) => [...m, userMsg]);
      setDraft("");
      setThinking(true);
      try {
        const transcript = [...messages, userMsg].map((m) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.body,
        }));
        const r = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "chat",
            funnel: ctx
              ? { need: ctx.need, stack: ctx.stack, urgency: ctx.urgency }
              : undefined,
            messages: transcript,
          }),
        });
        const j = (await r.json()) as { text?: string; fallback?: string };
        if (j.fallback) console.warn("[try-room] assistant fallback:", j.fallback);
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            body: j.text ?? "Noted — keep going.",
          },
        ]);
      } catch {
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "assistant",
            body: "Noted — keep going. (Network hiccup; engineer will see this.)",
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [draft, thinking, messages, ctx],
  );

  if (!hydrated) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--background, #fafaf7)",
          color: "var(--text-muted, #6b6b6b)",
        }}
      >
        <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--background, #fafaf7)",
        padding: "24px 16px 48px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-muted, #6b6b6b)",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={14} />
            relay.green
          </Link>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--primary-hover, #2d4422)",
              background: "var(--primary-tint, rgba(63,92,46,0.08))",
              padding: "4px 10px",
              borderRadius: 999,
            }}
          >
            session · guest
          </span>
        </header>

        {ctx?.engineerPseudoName ? (
          <section
            style={{
              padding: 16,
              borderRadius: 14,
              border: "1px solid var(--border, #e8e8e2)",
              background: "var(--surface, #ffffff)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 18,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                background: "var(--primary-tint, rgba(63,92,46,0.12))",
                color: "var(--primary-hover, #2d4422)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-serif), serif",
                fontWeight: 600,
                fontSize: 17,
              }}
            >
              {ctx.engineerPseudoName
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text, #1a1a1a)",
                }}
              >
                {ctx.engineerPseudoName} is on the way
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted, #6b6b6b)" }}>
                Available now · ~25s to join
              </div>
              {stackTags.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {stackTags.slice(0, 5).map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--surface-raised, #f4f4f0)",
                        color: "var(--text, #1a1a1a)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <span
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 999,
                background: "var(--primary, #3f5c2e)",
                color: "#fff",
              }}
            >
              10 min free
            </span>
          </section>
        ) : null}

        <section
          style={{
            borderRadius: 16,
            border: "1px solid var(--border, #e8e8e2)",
            background: "var(--surface, #ffffff)",
            display: "flex",
            flexDirection: "column",
            minHeight: 480,
          }}
        >
          <div
            ref={threadRef}
            style={{
              flex: 1,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              overflowY: "auto",
              maxHeight: "60vh",
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  color: "var(--text-muted, #6b6b6b)",
                  fontSize: 13,
                  padding: 40,
                }}
              >
                <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                Connecting…
              </div>
            ) : null}
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                  lineHeight: 1.5,
                  background:
                    m.role === "user"
                      ? "var(--primary, #3f5c2e)"
                      : "var(--surface-raised, #f4f4f0)",
                  color:
                    m.role === "user"
                      ? "#ffffff"
                      : "var(--text, #1a1a1a)",
                }}
              >
                {m.body}
              </div>
            ))}
            {thinking ? (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 14px",
                  borderRadius: 14,
                  background: "var(--surface-raised, #f4f4f0)",
                  color: "var(--text-muted, #6b6b6b)",
                  fontSize: 13,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                thinking…
              </div>
            ) : null}
          </div>

          <form
            onSubmit={send}
            style={{
              borderTop: "1px solid var(--border, #e8e8e2)",
              padding: 12,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Describe what you're stuck on…"
              style={{
                flex: 1,
                appearance: "none",
                border: "1px solid var(--border, #e8e8e2)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                background: "var(--surface, #ffffff)",
                color: "var(--text, #1a1a1a)",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!draft.trim() || thinking}
              className="r-btn r-btn-green"
              style={{
                opacity: !draft.trim() || thinking ? 0.5 : 1,
                cursor: !draft.trim() || thinking ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Send size={14} />
              Send
            </button>
          </form>
        </section>

        <p
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--text-muted, #6b6b6b)",
            textAlign: "center",
          }}
        >
          Guest session — first 10 minutes free. Your context is saved locally.
        </p>
      </div>
    </main>
  );
}
