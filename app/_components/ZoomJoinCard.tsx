"use client";

/*
 * Zoom join card — replaces the embedded Meeting SDK with a link card.
 *
 * Renders inline in the chat stream when a session has a Zoom meeting.
 * Shows the meeting id + a copyable join link, and a primary "Join meeting"
 * button that opens Zoom in a new tab. The optional `onJoin` callback fires
 * the moment the user clicks join — that's where the room calls markJoined()
 * so the session flips to "live" without waiting on a Zoom webhook.
 */

import { useState } from "react";
import {
  Video,
  Copy,
  Check,
  ExternalLink,
  PhoneOff,
  Loader2,
  RotateCw,
} from "lucide-react";

const BRAND_GREEN = "var(--primary)";
const BRAND_GREEN_BORDER =
  "color-mix(in srgb, var(--primary) 32%, transparent)";
const BRAND_GREEN_SOFT = "var(--primary-soft)";
type Props = {
  meetingId: string;
  joinUrl: string | null;
  /** Fires once the user clicks Join — typically calls markJoined(). */
  onJoin?: () => void | Promise<void>;
  /** Heading shown at the top of the card. Defaults to "Zoom meeting ready". */
  title?: string;
  /** Optional one-line subtitle (e.g. "Your engineer is on the call"). */
  subtitle?: string;
  /** When true, render in the "Meeting ended" state — Join disabled,
   *  copy hidden, muted styling. The Relay session itself keeps running. */
  ended?: boolean;
  /** Optional handler exposed only when ended=true. When provided, the
   *  card renders a "Start new meeting" button alongside the ended badge.
   *  Wired up by the engineer side; customers don't get this (they can't
   *  mint Zoom meetings — RLS-restricted). */
  onRestart?: () => void | Promise<void>;
};

export function ZoomJoinCard({
  meetingId,
  joinUrl,
  onJoin,
  title,
  subtitle,
  ended,
  onRestart,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const handleCopy = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — surface nothing */
    }
  };

  const handleJoin = () => {
    if (!joinUrl) return;
    void onJoin?.();
    window.open(joinUrl, "_blank", "noopener,noreferrer");
  };

  // Format the meeting id as Zoom does in the client: 123 4567 8901
  const prettyId = meetingId
    .replace(/\D/g, "")
    .replace(/(\d{3})(\d{4})(\d+)/, "$1 $2 $3");

  return (
    <div
      className="rounded-2xl border p-4 shadow-sm"
      style={{
        borderColor: ended ? "var(--border)" : BRAND_GREEN_BORDER,
        backgroundColor: "var(--surface)",
        opacity: ended ? 0.75 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: ended
              ? "color-mix(in srgb, var(--text) 6%, transparent)"
              : BRAND_GREEN_SOFT,
            color: ended ? "var(--text-muted)" : BRAND_GREEN,
          }}
        >
          {ended ? <PhoneOff size={18} /> : <Video size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            {ended ? "Meeting ended" : (title ?? "Zoom meeting ready")}
          </div>
          {ended ? (
            <div
              className="mt-0.5 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              The Zoom call has ended. You can keep chatting here.
            </div>
          ) : subtitle ? (
            <div
              className="mt-0.5 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className="text-[10px] tracking-wider uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Meeting ID
          </span>
          <span
            className="text-sm font-medium tabular-nums"
            style={{ color: "var(--text)" }}
          >
            {prettyId || "—"}
          </span>
        </div>

        {joinUrl && !ended ? (
          <div
            className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
            style={{ borderColor: "var(--border)" }}
          >
            <span
              className="min-w-0 flex-1 truncate text-xs"
              style={{ color: "var(--text-muted)" }}
              title={joinUrl}
            >
              {joinUrl}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                color: copied ? BRAND_GREEN : "var(--text)",
                backgroundColor: copied ? BRAND_GREEN_SOFT : "transparent",
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={ended ? undefined : handleJoin}
        disabled={ended || !joinUrl}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          backgroundColor: ended
            ? "color-mix(in srgb, var(--text) 8%, transparent)"
            : BRAND_GREEN,
          color: ended ? "var(--text-muted)" : "#fff",
        }}
      >
        {ended ? (
          <>
            <PhoneOff size={14} />
            Meeting ended
          </>
        ) : (
          <>
            <ExternalLink size={14} />
            Join meeting
          </>
        )}
      </button>

      {ended && onRestart ? (
        <button
          type="button"
          onClick={async () => {
            if (restarting) return;
            setRestarting(true);
            try {
              await onRestart();
            } finally {
              setRestarting(false);
            }
          }}
          disabled={restarting}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: BRAND_GREEN, color: "#fff" }}
        >
          {restarting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCw size={14} />
          )}
          {restarting ? "Starting new meeting…" : "Start new meeting"}
        </button>
      ) : null}
    </div>
  );
}
