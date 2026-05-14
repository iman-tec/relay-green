"use client";

/*
 * Inline Zoom call card — one card per meeting in the chat timeline, like
 * the call entries WhatsApp / Instagram put inline with messages.
 *
 * Each call is represented by TWO system messages in `guest_messages`:
 *   • zoom_call_started — posted by mint-zoom-for-session
 *   • zoom_call_ended   — posted by the zoom-webhook when the host ends it
 *
 * They share a meetingId. The ChatPane pairs them and renders this single
 * card; the standalone `zoom_call_ended` row is suppressed in the message
 * stream (handled at the render site).
 */

import { useState } from "react";
import { Video, PhoneOff, ExternalLink, RotateCw, Loader2, Copy, Check } from "lucide-react";

const BRAND_GREEN        = "#3f5c2e";
const BRAND_GREEN_SOFT   = "rgba(63, 92, 46, 0.12)";
const BRAND_GREEN_BORDER = "rgba(63, 92, 46, 0.32)";

export type ZoomCallStartedPayload = {
  type: "zoom_call_started";
  meetingId: string;
  joinUrl: string;
  startedAt: string;
};

export type ZoomCallEndedPayload = {
  type: "zoom_call_ended";
  meetingId: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
};

export type ZoomCallMsg = ZoomCallStartedPayload | ZoomCallEndedPayload;

/** Best-effort parser. Returns null for any message body that isn't one of
 *  the two Zoom-call message shapes — including plain-text system messages,
 *  guest/engineer chat, or malformed JSON. */
export function parseZoomCallMsg(body: string): ZoomCallMsg | null {
  if (!body || body[0] !== "{") return null;
  try {
    const p = JSON.parse(body) as { type?: string };
    if (p?.type === "zoom_call_started" || p?.type === "zoom_call_ended") {
      return p as ZoomCallMsg;
    }
    return null;
  } catch {
    return null;
  }
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "Less than a minute";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${r} sec`;
  return `${r} sec`;
}

type Props = {
  started: ZoomCallStartedPayload;
  ended: ZoomCallEndedPayload | null;
  /** Side of the chat — controls alignment, mirrors how regular messages
   *  align ("guest" / "engineer" lands on the viewer's side). */
  side: "left" | "right";
  /** Fires when the user clicks Join on an active call. Typically calls
   *  state.markJoined() and opens the join URL in a new tab — but opening
   *  the URL is the card's responsibility. */
  onJoin?: () => void | Promise<void>;
  /** Engineer-only and only set on the latest ended call: starts a new
   *  Zoom meeting in the same Relay session (replaces this one as the
   *  active call). */
  onRestart?: () => void | Promise<void>;
};

export function ZoomCallCard({ started, ended, side, onJoin, onRestart }: Props) {
  const [copied, setCopied] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const isActive = !ended;
  const prettyId = started.meetingId.replace(/\D/g, "").replace(/(\d{3})(\d{4})(\d+)/, "$1 $2 $3");
  const duration = ended ? formatDuration(ended.durationSec) : null;
  const joinUrl = started.joinUrl;

  const handleCopy = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked */ }
  };

  const handleJoin = () => {
    if (!joinUrl) return;
    void onJoin?.();
    window.open(joinUrl, "_blank", "noopener,noreferrer");
  };

  const headline = isActive ? "Zoom call · ongoing" : "Zoom call · ended";
  const meta = isActive
    ? "Tap Join to open the meeting in a new tab."
    : duration
      ? `Duration · ${duration}`
      : "Ended";

  return (
    <div className={`flex w-full ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className="w-full max-w-sm rounded-2xl border p-3.5 shadow-sm"
        style={{
          borderColor: isActive ? BRAND_GREEN_BORDER : "var(--border)",
          backgroundColor: "var(--surface)",
          opacity: isActive ? 1 : 0.95,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{
              backgroundColor: isActive
                ? BRAND_GREEN_SOFT
                : "color-mix(in srgb, var(--text) 8%, transparent)",
              color: isActive ? BRAND_GREEN : "var(--text-muted)",
            }}
          >
            {isActive ? <Video size={16} /> : <PhoneOff size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {headline}
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {meta}
            </div>
          </div>
        </div>

        {isActive ? (
          <>
            <div
              className="mt-2.5 flex items-center gap-2 rounded-lg border px-2 py-1.5"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: "var(--text-muted)" }}>
                ID
              </span>
              <span className="min-w-0 flex-1 truncate text-xs tabular-nums" style={{ color: "var(--text)" }} title={joinUrl}>
                {prettyId}
              </span>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  color: copied ? BRAND_GREEN : "var(--text-muted)",
                  backgroundColor: copied ? BRAND_GREEN_SOFT : "transparent",
                }}
                title="Copy join link"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <button
              type="button"
              onClick={handleJoin}
              disabled={!joinUrl}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
            >
              <ExternalLink size={13} />
              Join meeting
            </button>
          </>
        ) : onRestart ? (
          <button
            type="button"
            onClick={async () => {
              if (restarting) return;
              setRestarting(true);
              try { await onRestart(); }
              finally { setRestarting(false); }
            }}
            disabled={restarting}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
          >
            {restarting ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
            {restarting ? "Starting new meeting…" : "Start new meeting"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
