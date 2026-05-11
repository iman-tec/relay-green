"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEngineerQueue } from "@/lib/relay/useEngineerQueue";
import { PhoneIncoming, AlertTriangle, Loader2 } from "lucide-react";
import type { GuestCall } from "@/lib/supabase/types";

const BRAND_GREEN = "#3f5c2e";
const BRAND_GREEN_SOFT = "rgba(63, 92, 46, 0.12)";
const URGENT_AMBER = "#c66645";
const URGENT_AMBER_SOFT = "rgba(198, 102, 69, 0.14)";
const CRIT_RED = "#c8553d";
const CRIT_RED_SOFT = "rgba(200, 85, 61, 0.18)";

export function TriageClient() {
  const router = useRouter();
  const { queue, loading, error, claim } = useEngineerQueue();
  const [busyId, setBusyId] = useState<string | null>(null);

  const onClaim = async (sessionId: string) => {
    setBusyId(sessionId);
    const claimed = await claim(sessionId);
    setBusyId(null);
    if (claimed) {
      router.push(`/staff/session/${claimed.id}`);
    }
  };

  return (
    <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          Triage
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {loading
            ? "Loading queue…"
            : queue.length === 0
            ? "Queue is empty — no customers waiting."
            : `${queue.length} customer${queue.length !== 1 ? "s" : ""} waiting — pick one to start.`}
        </p>
      </div>

      {error && (
        <div
          className="rounded-md border px-4 py-2.5 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent-red) 8%, transparent)",
            color: "var(--accent-red)",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: BRAND_GREEN }} />
        </div>
      ) : queue.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {queue.map((s) => (
            <QueueRow
              key={s.id}
              session={s}
              busy={busyId === s.id}
              onClaim={() => onClaim(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueRow({
  session,
  busy,
  onClaim,
}: {
  session: GuestCall;
  busy: boolean;
  onClaim: () => void;
}) {
  const u = session.urgency;
  const accent =
    u === "critical" ? { bg: CRIT_RED_SOFT, fg: CRIT_RED }
    : u === "urgent"  ? { bg: URGENT_AMBER_SOFT, fg: URGENT_AMBER }
    : { bg: BRAND_GREEN_SOFT, fg: BRAND_GREEN };

  const waitingMs = Date.now() - new Date(session.created_at).getTime();
  const waitingMin = Math.floor(waitingMs / 60_000);
  const waitingSec = Math.floor((waitingMs % 60_000) / 1000);

  return (
    <div
      className="flex items-center gap-4 rounded-xl border px-5 py-4"
      style={{
        borderColor: u === "normal" ? "var(--border)" : accent.fg + "55",
        backgroundColor: "var(--surface)",
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase"
        style={{ backgroundColor: accent.bg, color: accent.fg }}
      >
        {(session.guest_name || "?")[0]}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
            {session.guest_name}
          </span>
          {session.guest_email && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {session.guest_email}
            </span>
          )}
          {u !== "normal" && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: accent.bg, color: accent.fg }}
            >
              <AlertTriangle size={10} /> {u}
            </span>
          )}
          {session.recall_count > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums"
              style={{
                backgroundColor: "color-mix(in srgb, var(--text) 8%, transparent)",
                color: "var(--text-muted)",
              }}
            >
              ↻ {session.recall_count} recall{session.recall_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="text-xs font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>
        Waiting {String(waitingMin).padStart(2, "0")}:{String(waitingSec).padStart(2, "0")}
      </div>

      <button
        onClick={onClaim}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <PhoneIncoming size={12} />}
        {busy ? "Claiming…" : "Take call"}
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-xl border border-dashed px-6 py-16 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN }}>
        <PhoneIncoming size={20} />
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
        No customers waiting
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        New requests will appear here in real time.
      </p>
    </div>
  );
}
