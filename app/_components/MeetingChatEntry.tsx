"use client";

/*
 * Compact inline meeting entry that lives inside the chat message stream.
 * Each "📞 Zoom meeting started" system message renders one of these at
 * its chronological position. The paired "📞 Zoom meeting ended" message
 * is folded in (the renderer suppresses it) so we get one entry per call.
 *
 * Active state shows a Join button using the session's current Zoom URLs.
 * Ended state shows a duration computed from the message timestamps.
 */

import { useState } from "react";
import { Video, PhoneOff, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { MeetingSummaryEntry } from "./MeetingSummaryEntry";

const BRAND_GREEN        = "#3f5c2e";
const BRAND_GREEN_SOFT   = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";

type Props = {
  active: boolean;
  /** Defined only when `active === false`. Seconds between the matching
   *  started/ended messages — formatted for display. */
  durationSec?: number;
  /** Only used when active; the Zoom URL the viewer should open. Customer
   *  passes zoom_join_url; engineer passes zoom_start_url. */
  joinUrl?: string | null;
  /** Fires alongside opening the Zoom URL — typically state.markJoined(). */
  onJoin?: () => void | Promise<void>;
  /** Engineer-only: hang up the Zoom call without joining it. Renders a
   *  small red "End" button next to Join on the active state. */
  onCancel?: () => void | Promise<void>;
  /** Ended-state only: when an AI Companion summary exists for this call,
   *  pass its raw body so the card can render a Sparkles toggle that
   *  expands the parsed summary inline below. Hidden by default to keep
   *  the chat timeline quiet. */
  summaryBody?: string | null;
  /** Ended-state only: the system-message body that carries the Zoom cloud
   *  recording URL + passcode (e.g. "🎥 Recording available: <url>\n
   *  Passcode: <pw>"). Threaded into the summary card so supervisors see
   *  the recording inside the expanded summary instead of as a separate
   *  chat chip. Pass null for non-supervisor viewers. */
  recordingBody?: string | null;
};

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "Under a minute";
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  if (m === 0) return `${r} sec`;
  if (r === 0) return `${m} min`;
  return `${m} min ${r} sec`;
}

export function MeetingChatEntry({ active, durationSec, joinUrl, onJoin, onCancel, summaryBody, recordingBody }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // The ✨ toggle appears whenever the card has *anything* worth surfacing —
  // an AI summary or a recording. A recording-only meeting (no summary)
  // still gets the toggle so supervisors can reach the URL + passcode.
  const hasSummary = !active && !!summaryBody;
  const hasRecording = !active && !!recordingBody;
  const canExpand = hasSummary || hasRecording;

  const handleJoin = () => {
    if (!joinUrl) return;
    void onJoin?.();
    window.open(joinUrl, "_blank", "noopener,noreferrer");
  };

  const handleCancel = async () => {
    if (!onCancel || cancelling) return;
    setCancelling(true);
    try { await onCancel(); }
    finally { setCancelling(false); }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="inline-flex max-w-md items-center gap-2.5 rounded-xl border px-3 py-2"
        style={{
          borderColor: active ? BRAND_GREEN_BORDER : "var(--border)",
          backgroundColor: active
            ? BRAND_GREEN_SOFT
            : "color-mix(in srgb, var(--text) 4%, transparent)",
        }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: active
              ? BRAND_GREEN
              : "color-mix(in srgb, var(--text) 10%, transparent)",
            color: active ? "#fff" : "var(--text-muted)",
          }}
        >
          {active ? <Video size={13} /> : <PhoneOff size={13} />}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
            {active ? "Zoom call · ongoing" : "Zoom call · ended"}
          </span>
          {!active && durationSec !== undefined ? (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {formatDuration(durationSec)}
            </span>
          ) : null}
        </div>
        {active && joinUrl ? (
          <button
            type="button"
            onClick={handleJoin}
            className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            <ExternalLink size={11} />
            Join
          </button>
        ) : null}
        {active && onCancel ? (
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={cancelling}
            title="End this Zoom call"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60"
            style={{ backgroundColor: "var(--accent-red)", color: "#fff" }}
          >
            {cancelling ? <Loader2 size={11} className="animate-spin" /> : <PhoneOff size={11} />}
            End
          </button>
        ) : null}
        {canExpand ? (
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            aria-pressed={summaryOpen}
            title={summaryOpen ? "Hide call summary" : "Show call summary"}
            className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: summaryOpen ? BRAND_GREEN : "transparent",
              color: summaryOpen ? "#fff" : BRAND_GREEN,
              border: `1px solid ${BRAND_GREEN_BORDER}`,
            }}
          >
            <Sparkles size={12} />
          </button>
        ) : null}
      </div>
      {canExpand && summaryOpen ? (
        <MeetingSummaryEntry
          body={summaryBody ?? "🤖 AI Companion summary"}
          recordingBody={recordingBody ?? null}
        />
      ) : null}
    </div>
  );
}
