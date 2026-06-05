"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PhoneOff } from "lucide-react";
import { ProjectAIAssistant } from "@/app/_components/ProjectAIAssistant";
import { createClient } from "@/lib/supabase/browser";
import { assistantChannelName } from "@/lib/relay/assistantTab";

export function AssistantTabClient() {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const projectId = params.get("project");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  // Resolve the project name for the assistant header (best-effort).
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void (async () => {
      const { data } = await createClient()
        .from("projects")
        .select("name")
        .eq("id", projectId)
        .maybeSingle();
      if (alive && data?.name) setProjectName(data.name as string);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Session-end signal from the session page: BroadcastChannel primary,
  // localStorage event fallback (older browsers). Also defensively poll the
  // session row so a tab opened on an already-dead session shows the end
  // state too.
  useEffect(() => {
    if (!sessionId) return;
    const name = assistantChannelName(sessionId);
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(name);
      ch.onmessage = (e) => {
        if (e.data?.type === "session-ended") setEnded(true);
      };
    } catch {
      /* unsupported — fallback below */
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === `${name}:ended`) setEnded(true);
    };
    window.addEventListener("storage", onStorage);

    const check = async () => {
      const { data } = await createClient()
        .from("guest_calls")
        .select("status")
        .eq("id", sessionId)
        .maybeSingle();
      if (
        data &&
        ["ended", "cancelled", "abandoned"].includes(
          (data as { status: string }).status
        )
      )
        setEnded(true);
    };
    void check();
    const poll = setInterval(() => void check(), 30_000);

    return () => {
      ch?.close();
      window.removeEventListener("storage", onStorage);
      clearInterval(poll);
    };
  }, [sessionId]);

  // Session over → close this assistant window. It was opened via
  // window.open from the session page, so self-close is permitted. When
  // the browser refuses (e.g. the engineer opened /staff/assistant as a
  // regular tab themselves), the "Session ended" banner below stays as
  // the fallback state.
  useEffect(() => {
    if (!ended) return;
    window.close();
  }, [ended]);

  return (
    <div
      className="relative flex h-dvh flex-col"
      style={{ backgroundColor: "var(--background)", color: "var(--text)" }}
    >
      {/* Centered reading column — the assistant was designed for a narrow
          side panel; unconstrained it stretches bubbles edge-to-edge on a
          full window. ~860px is the comfortable Q&A width; the column gets
          a faint frame so it reads as the page's content, not a strip
          floating in a void. */}
      <div className="mx-auto min-h-0 w-full max-w-[860px] flex-1 px-4 py-2 sm:px-6">
        <div
          className="h-full overflow-hidden rounded-2xl border"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface)",
          }}
        >
          <ProjectAIAssistant projectId={projectId} projectName={projectName} />
        </div>
      </div>

      {/* "Session ended" — quiet overlay; project memory stays readable
          behind it, the banner just makes the state unmistakable. */}
      {ended && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-4"
          aria-live="polite"
        >
          <div
            className="pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text)",
            }}
          >
            <PhoneOff size={14} style={{ color: "var(--risk)" }} />
            Session ended — you can keep browsing this project&apos;s memory.
          </div>
        </div>
      )}
    </div>
  );
}
